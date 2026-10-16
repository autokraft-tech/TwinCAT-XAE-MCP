using System;
using System.Collections.Concurrent;
using System.Threading;

namespace Te1000Daemon
{
    // Error classification carried over the wire as `errorKind`; index.js maps
    // these back to the existing user-facing messages.
    public enum ErrorKind
    {
        ComError,       // generic COM/automation error -> "com_error"
        DialogBlocked,  // a modal dialog blocked the call -> "dialog_blocked"
        Timeout         // hard wall-clock timeout, no dialog -> "timeout"
    }

    // Thrown by handlers/helpers to produce a clean {ok:false,error,errorKind}.
    public sealed class BridgeException : Exception
    {
        private readonly ErrorKind _kind;
        private readonly DialogSnapshot _dialog;
        public ErrorKind Kind { get { return _kind; } }
        public DialogSnapshot Dialog { get { return _dialog; } }
        public BridgeException(string message, ErrorKind kind = ErrorKind.ComError, DialogSnapshot dialog = null)
            : base(message) { _kind = kind; _dialog = dialog; }
    }

    // Result of a worker job.
    internal sealed class WorkResult
    {
        public bool Ok;
        public Json.JObj Data;       // the `data` payload on success (may be null)
        public string Error;        // error message on failure
        public ErrorKind Kind = ErrorKind.ComError;
        public DialogSnapshot Dialog;
    }

    internal sealed class WorkItem
    {
        public Func<Json.JObj> Job;            // runs on the STA thread
        public readonly ManualResetEventSlim Done = new ManualResetEventSlim(false);
        public WorkResult Result;
    }

    // Owns the single STA thread that makes all DTE/COM calls. Serializes
    // requests through a blocking queue. On a per-request hard timeout (or a
    // persistent modal dialog), stops accepting work until an operator resolves
    // the indeterminate call and restarts the daemon. Never starts a second STA.
    public sealed class ComWorker : IDisposable
    {
        private readonly DialogWatcher _watcher;
        private readonly int _defaultTimeoutMs;
        private readonly int _blockGraceMs;

        private BlockingCollection<WorkItem> _queue;
        private Thread _sta;
        private ComSession _session;
        private readonly object _lifecycleGate = new object();
        private volatile bool _disposed;
        private volatile bool _faulted;

        public ComWorker(DialogWatcher watcher, int defaultTimeoutMs, int blockGraceMs)
        {
            _watcher = watcher;
            _defaultTimeoutMs = defaultTimeoutMs;
            _blockGraceMs = blockGraceMs;
            StartThread();
        }

        public ComSession Session { get { return _session; } }

        // The dialog watcher (may be null when started with --no-watch). Exposed so
        // the Dispatcher can serve a COM-free `dialog_probe` diagnostic action.
        public DialogWatcher Watcher { get { return _watcher; } }

        private void StartThread()
        {
            _queue = new BlockingCollection<WorkItem>();
            _session = new ComSession();
            _session.ProcessIdentified = delegate(int pid) { if (_watcher != null) _watcher.TargetPid = pid; };
            _sta = new Thread(Pump) { IsBackground = true, Name = "te1000-com-sta" };
            _sta.SetApartmentState(ApartmentState.STA);
            _sta.Start();
        }

        private void Pump()
        {
            // Register the message filter on THIS STA thread (per-thread).
            try { Te1000MessageFilter.Register(); } catch (Exception ex) { Log.Error("MessageFilter.Register", ex); }

            try
            {
            foreach (var item in _queue.GetConsumingEnumerable())
            {
                WorkResult res = new WorkResult();
                try
                {
                    var data = item.Job();
                    res.Ok = true;
                    res.Data = data;
                }
                catch (BridgeException bex)
                {
                    res.Ok = false;
                    res.Error = bex.Message;
                    res.Kind = bex.Kind;
                    res.Dialog = bex.Dialog;
                }
                catch (Exception ex)
                {
                    res.Ok = false;
                    res.Error = ex.Message;
                    res.Kind = ErrorKind.ComError;
                }
                item.Result = res;
                item.Done.Set();
            }
            }
            finally { _session.Dispose(); }
        }

        // Enqueue a job and wait for it on the STA thread, honoring a hard
        // timeout and the modal-dialog grace window. Returns the WorkResult.
        internal WorkResult Run(Func<Json.JObj> job, int timeoutMs)
        {
            if (_disposed) throw new ObjectDisposedException("ComWorker");
            if (_faulted) return new WorkResult { Ok = false, Error = "COM worker stopped after timeout/dialog; result may be indeterminate. Resolve XAE state and restart daemon; do not replay writes.", Kind = ErrorKind.ComError };
            int budget = timeoutMs > 0 ? timeoutMs : _defaultTimeoutMs;

            WorkItem item;
            lock (_lifecycleGate)
            {
                if (_faulted) return new WorkResult { Ok = false, Error = "COM worker is stopped; restart daemon after resolving XAE state." };
                item = new WorkItem { Job = job };
                _queue.Add(item);
            }

            // Wait loop: poll for completion, the dialog grace window, and the
            // hard timeout. 0/negative budget => wait indefinitely (long builds).
            // Stopwatch (not Environment.TickCount) so the elapsed comparison is
            // correct across the ~24.9-day TickCount wrap (no TickCount64 on net472).
            var sw = System.Diagnostics.Stopwatch.StartNew();
            int pollMs = 100;
            while (true)
            {
                if (item.Done.Wait(pollMs)) return item.Result;

                // Modal dialog persisting past the grace window -> abandon.
                long blockedFor = _watcher != null ? _watcher.BlockingForMs : 0;
                if (blockedFor >= _blockGraceMs && _blockGraceMs > 0)
                {
                    var snap = _watcher.Latest;
                    StopAfterIndeterminateCall();
                    return new WorkResult
                    {
                        Ok = false,
                        Kind = ErrorKind.DialogBlocked,
                        Dialog = snap,
                        Error = "XAE is blocked on a modal dialog."
                    };
                }

                if (budget > 0 && sw.ElapsedMilliseconds >= budget)
                {
                    StopAfterIndeterminateCall();
                    return new WorkResult
                    {
                        Ok = false,
                        Kind = ErrorKind.Timeout,
                        Error = "Call exceeded timeout of " + budget + " ms; no modal dialog detected — XAE may be busy."
                    };
                }
            }
        }

        // A timed-out COM call can still finish later. Never start another STA
        // or accept more work while the outcome is unknown.
        private void StopAfterIndeterminateCall()
        {
            lock (_lifecycleGate)
            {
                _faulted = true;
                _queue.CompleteAdding();
                WorkItem pending;
                while (_queue.TryTake(out pending))
                {
                    pending.Result = new WorkResult { Ok = false, Error = "COM worker stopped; queued request was not executed." };
                    pending.Done.Set();
                }
            }
        }
        public void Dispose()
        {
            _disposed = true;
            try { _queue.CompleteAdding(); } catch { }
            // The owning STA releases COM in Pump.finally.
            if (Thread.CurrentThread != _sta) _sta.Join(5000);
        }
    }
}
