using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace Te1000Daemon
{
    // Acquires and CACHES the DTE + ITcSysManager once, with a cheap health-check
    // and transparent reconnect. Ports Get-PreferredDteFromRot (bridge L387-419),
    // Get-Dte (L533-579), and Get-SysManager (L623-676). All members are called
    // on the owning STA thread (ComWorker.Pump).
    public sealed class ComSession
    {
        private dynamic _dte;
        private dynamic _sysManager;
        private string _progId;
        private string _mode;
        private bool _owned;
        private int _xaePid;
        private long _xaeStartTicks;
        private int _openCount;
        private System.Threading.Mutex _ownerMutex;
        private string _initializationError;
        private string _initializationStage = "DTE acquisition";
        public Action<int> ProcessIdentified;

        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

        public int XaePid { get { return _xaePid; } }
        private ProjectSaveAudit _saveAudit;
        internal ProjectSaveAudit SaveAudit { get { return _saveAudit ?? (_saveAudit = new ProjectSaveAudit(OfflinePolicy.SolutionPath)); } }
        internal void BeforeObjectWrite(string path, bool create, int type = 604)
        {
            foreach (dynamic document in _dte.Documents)
                if (!(bool)document.Saved) throw new BridgeException("Unsaved editor document detected; preserve user edits before MCP writes.");
            SaveAudit.BeforeObjectWrite(path, create, type);
        }
        internal Json.JObj SaveAudited()
        {
            AssertSolution();
            string root = Path.GetDirectoryName(Path.GetFullPath(OfflinePolicy.SolutionPath)) + Path.DirectorySeparatorChar;
            foreach (dynamic project in _dte.Solution.Projects)
                if (!Path.GetFullPath((string)project.FullName).StartsWith(root, StringComparison.OrdinalIgnoreCase))
                    throw new BridgeException("SaveAll scope contains a project outside the pinned solution directory.");
            foreach (dynamic document in _dte.Documents)
                if (!(bool)document.Saved)
                    throw new BridgeException("Unsaved editor document detected; SaveAll could overwrite user edits. Save refused.");
            return SaveAudit.Save(delegate { _dte.ExecuteCommand("File.SaveAll"); });
        }
        public bool CloseOwned()
        {
            if (_dte == null || !_owned || !ProcessAlive()) return false;
            AssertSolution();
            if (!(bool)_dte.Solution.Saved) throw new BridgeException("Owned solution has unsaved changes; refusing shutdown.");
            foreach (dynamic project in _dte.Solution.Projects)
                if (!(bool)project.Saved) throw new BridgeException("Owned project has unsaved changes; refusing shutdown.");
            foreach (dynamic document in _dte.Documents)
                if (!(bool)document.Saved) throw new BridgeException("Owned document has unsaved changes; refusing shutdown.");
            _dte.Solution.Close(false);
            _dte.Quit();
            _owned = false;
            return true;
        }
        public Json.JObj Info()
        {
            var info = new Json.JObj();
            info["xaePid"] = _xaePid;
            info["daemonPid"] = Process.GetCurrentProcess().Id;
            info["owned"] = _owned;
            info["mode"] = _mode;
            info["solutionOpenCount"] = _openCount;
            return info;
        }

        private bool ProcessAlive()
        {
            try { using (var p = Process.GetProcessById(_xaePid)) return !p.HasExited && p.StartTime.ToUniversalTime().Ticks == _xaeStartTicks; }
            catch (ArgumentException) { return false; }
        }

        private void RecordProcess()
        {
            uint pid;
            GetWindowThreadProcessId(new IntPtr((long)_dte.MainWindow.HWnd), out pid);
            if (pid == 0) throw new BridgeException("Cannot identify XAE process; refusing an unowned session.");
            _xaePid = (int)pid;
            using (var p = Process.GetProcessById(_xaePid)) _xaeStartTicks = p.StartTime.ToUniversalTime().Ticks;
            if (ProcessIdentified != null) ProcessIdentified(_xaePid);
        }

        public void AssertSolution()
        {
            string actual = (string)_dte.Solution.FullName;
            if (!OfflinePolicy.SamePath(actual, OfflinePolicy.SolutionPath))
                throw new BridgeException("Wrong solution; expected '" + OfflinePolicy.SolutionPath + "', actual '" + actual + "'. No operation performed.");
        }

        public void OpenPinnedSolution(bool reload)
        {
            if (reload)
            {
                if (!_owned) throw new BridgeException("Cannot close a user-owned XAE solution.");
                OfflinePolicy.AssertWritableSolution();
                AssertSolution();
                SaveAudited();
                _dte.Solution.Close(false);
                _sysManager = null;
            }
            else
            {
                string current = (string)_dte.Solution.FullName;
                if (!string.IsNullOrEmpty(current)) { AssertSolution(); return; }
                if (!_owned) throw new BridgeException("Will not open a solution in a user-owned XAE instance.");
            }
            _initializationStage = "Solution.Open";
            Log.Write("Opening pinned solution: " + OfflinePolicy.SolutionPath);
            _dte.Solution.Open(OfflinePolicy.SolutionPath);
            _openCount++;
            var deadline = DateTime.UtcNow.AddSeconds(90);
            do
            {
                try
                {
                    string actual = (string)_dte.Solution.FullName;
                    if (!string.IsNullOrEmpty(actual)) { AssertSolution(); return; }
                }
                catch (Exception ex) { if (!ComHelpers.IsRetryableComError(ex) && !(ex is Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)) throw; }
                System.Threading.Thread.Sleep(250);
            } while (DateTime.UtcNow < deadline);
            throw new BridgeException("Timed out waiting for the pinned solution.");
        }

        // Best-effort release of a COM RCW. Guards against already-released RCWs
        // and non-COM objects (Marshal.ReleaseComObject throws ArgumentException
        // on a non-COM object, InvalidComObjectException on an already-released
        // one). Release our reference once; never over-release a shared RCW.
        private static void SafeRelease(object com)
        {
            if (com == null) return;
            try
            {
                if (!Marshal.IsComObject(com)) return;
                Marshal.ReleaseComObject(com);
            }
            catch { /* already released / not a COM RCW — ignore */ }
        }

        // Return a live, cached DTE for (progId, mode); reconnect if stale/dead.
        public dynamic GetDte(string progId, string mode, bool visible = true)
        {
            progId = OfflinePolicy.ProgId;
            mode = OfflinePolicy.SessionMode;
            if (_initializationError != null) throw new BridgeException(_initializationError);

            if (_dte != null && _progId == progId)
            {
                if (ProcessAlive())
                {
                    // A busy live XAE must never cause a second instance to start.
                    AssertSolution();
                    return _dte;
                }
                SafeRelease((object)_sysManager); SafeRelease((object)_dte);
                _dte = null; _sysManager = null; _owned = false;
            }

            try
            {
                _dte = AcquireDte(progId, mode, visible);
                _progId = progId;
                _mode = mode;
                _sysManager = null;
                RecordProcess();
                if (_owned) OpenPinnedSolution(false);
                AssertSolution();
            }
            catch (Exception ex)
            {
                Log.Error("Session initialization at " + _initializationStage, ex);
                _initializationError = "Session initialization failed at " + _initializationStage + "; restart daemon after resolving: " + ex.Message;
                throw new BridgeException(_initializationError);
            }
            return _dte;
        }

        // The mode is fixed at daemon startup, never by a tool request.
        private dynamic AcquireDte(string progId, string mode, bool visible)
        {
            switch (mode)
            {
                case "active":
                {
                    dynamic d = GetPreferredDteFromRot(progId);
                    if (d != null) return d;
                    return Marshal.GetActiveObject(progId);
                }
                case "createOnce":
                    return CreateOwnedDte(progId, visible);
                default:
                    throw new BridgeException("Unsupported DTE mode: " + mode);
            }
        }

        private dynamic CreateOwnedDte(string progId, bool visible)
        {
            // A persisted ownership lease prevents duplicate XAE after daemon failure.
            string key;
            using (var sha = System.Security.Cryptography.SHA256.Create())
                key = BitConverter.ToString(sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(Path.GetFullPath(OfflinePolicy.SolutionPath).ToUpperInvariant()))).Replace("-", "");
            if (_ownerMutex == null)
            {
                _ownerMutex = new System.Threading.Mutex(false, "Local\\NexPlcXae_" + key);
                bool acquired;
                try { acquired = _ownerMutex.WaitOne(0); } catch (System.Threading.AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new BridgeException("Another daemon owns this solution's createOnce session.");
            }
            string leaseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NexPlcXaeMcp");
            Directory.CreateDirectory(leaseDir);
            string lease = Path.Combine(leaseDir, key + ".lease");
            if (File.Exists(lease))
            {
                string[] fields = File.ReadAllLines(lease);
                int pid; long ticks;
                if (fields.Length != 2 || !int.TryParse(fields[0], out pid) || !long.TryParse(fields[1], out ticks))
                    throw new BridgeException("Invalid XAE ownership lease: " + lease);
                bool alive = false;
                try { using (var p = Process.GetProcessById(pid)) alive = !p.HasExited && p.StartTime.ToUniversalTime().Ticks == ticks; }
                catch (ArgumentException) { }
                if (alive)
                {
                    RotEntry recovered = null;
                    foreach (var entry in ListRunningDte(progId))
                    {
                        uint entryPid;
                        GetWindowThreadProcessId(new IntPtr((long)entry.Dte.MainWindow.HWnd), out entryPid);
                        if (entryPid == pid && OfflinePolicy.SamePath(entry.Solution, OfflinePolicy.SolutionPath))
                        { recovered = entry; }
                        else SafeRelease((object)entry.Dte);
                    }
                    if (recovered != null) { _owned = true; return recovered.Dte; }
                    throw new BridgeException("Owned XAE PID " + pid + " is still alive but cannot be reattached. Close that instance manually before restarting; no duplicate was created.");
                }
            }
            // If COM creation crashes before the PID is known, an invalid/pending
            // lease forces operator review instead of starting a duplicate XAE.
            File.WriteAllLines(lease, new[] { "pending", Process.GetCurrentProcess().Id.ToString() });
            dynamic created = CreateDte(progId, visible);
            _dte = created;
            _owned = true;
            RecordProcess();
            File.WriteAllLines(lease, new[] { _xaePid.ToString(), _xaeStartTicks.ToString() });
            _initializationStage = "TcRemoteManager lookup";
            Log.Write("Created owned XAE PID " + _xaePid + "; selecting engineering version " + OfflinePolicy.XaeVersion);
            dynamic remote = created.GetObject("TcRemoteManager");
            _initializationStage = "TcRemoteManager.Version";
            remote.Version = OfflinePolicy.XaeVersion;
            return created;
        }

        private dynamic CreateDte(string progId, bool visible)
        {
            Type t = Type.GetTypeFromProgID(progId);
            if (t == null) throw new BridgeException("ProgID not registered: " + progId);
            dynamic dte = Activator.CreateInstance(t);
            try { dte.SuppressUI = true; } catch { }
            try { dte.MainWindow.Visible = visible; } catch { }
            return dte;
        }

        // Get-PreferredDteFromRot (L387-419) + DteRotProbe (L286-371): enumerate
        // the Running Object Table for monikers matching the progId, prefer one
        // with an open solution (or TE1000_MCP_SOLUTION_PATH).
        private dynamic GetPreferredDteFromRot(string progId)
        {
            var entries = ListRunningDte(progId);
            if (entries.Count == 0) return null;

            RotEntry chosen = null;
            string preferred = Environment.GetEnvironmentVariable("TE1000_MCP_SOLUTION_PATH");
            if (!string.IsNullOrWhiteSpace(preferred))
            {
                foreach (var e in entries)
                    if (!string.IsNullOrWhiteSpace(e.Solution) && string.Equals(e.Solution, preferred, StringComparison.OrdinalIgnoreCase))
                    { chosen = e; break; }
            }
            if (chosen == null && string.IsNullOrWhiteSpace(preferred))
            {
                foreach (var e in entries)
                    if (!string.IsNullOrWhiteSpace(e.Solution)) { chosen = e; break; }
            }
            if (chosen == null && string.IsNullOrWhiteSpace(preferred)) chosen = entries[0];

            // Release the DTE RCWs of every ROT entry we did NOT return; only the
            // chosen one survives (the caller takes ownership of it).
            foreach (var e in entries)
                if (!ReferenceEquals(e, chosen)) SafeRelease((object)e.Dte);

            return chosen == null ? null : chosen.Dte;
        }

        private sealed class RotEntry { public string DisplayName; public string Solution; public dynamic Dte; }

        [DllImport("ole32.dll")] private static extern int GetRunningObjectTable(int reserved, out IRunningObjectTable prot);
        [DllImport("ole32.dll")] private static extern int CreateBindCtx(int reserved, out IBindCtx ppbc);

        private List<RotEntry> ListRunningDte(string progId)
        {
            var result = new List<RotEntry>();
            IRunningObjectTable rot = null;
            IBindCtx bindCtx = null;
            IEnumMoniker enumerator = null;
            try
            {
                if (GetRunningObjectTable(0, out rot) != 0 || rot == null) return result;
                if (CreateBindCtx(0, out bindCtx) != 0 || bindCtx == null) return result;
                rot.EnumRunning(out enumerator);
                if (enumerator == null) return result;
                var monikers = new IMoniker[1];
                while (enumerator.Next(1, monikers, IntPtr.Zero) == 0)
                {
                    object raw = null;
                    try
                    {
                        string name;
                        monikers[0].GetDisplayName(bindCtx, null, out name);
                        if (string.IsNullOrWhiteSpace(name) || name.IndexOf(progId, StringComparison.OrdinalIgnoreCase) < 0) continue;
                        rot.GetObject(monikers[0], out raw);
                        if (raw == null) continue;
                        dynamic candidate = raw;
                        string solution = (string)candidate.Solution.FullName;
                        result.Add(new RotEntry { DisplayName = name, Solution = solution, Dte = candidate });
                        raw = null; // Result takes ownership of this reference.
                    }
                    catch (Exception ex) { Log.Error("ROT candidate", ex); }
                    finally { SafeRelease(raw); SafeRelease(monikers[0]); monikers[0] = null; }
                }
                return result;
            }
            finally { SafeRelease(enumerator); SafeRelease(bindCtx); SafeRelease(rot); }
        }
        // Get-SysManager (L623-676): prefer the loaded .tsproj project Object
        // (stays bound to the live config), else DTE.GetObject('TcSysManager').
        // Cached; retries transient RPC busy.
        public dynamic GetSysManager()
        {
            if (_sysManager != null)
            {
                if (IsSysManagerAlive(_sysManager)) return _sysManager;
                _sysManager = null;
            }
            if (_dte == null) throw new BridgeException("DTE not acquired");

            for (int attempt = 1; attempt <= 40; attempt++)
            {
                try
                {
                    dynamic solution = _dte.Solution;
                    if (solution != null && solution.Projects != null)
                    {
                        int count = (int)solution.Projects.Count;
                        for (int i = 1; i <= count; i++)
                        {
                            dynamic project = solution.Projects.Item(i);
                            if (project == null) continue;
                            string fullName = null;
                            try { fullName = (string)project.FullName; } catch { }
                            if ((string)project.Name != OfflinePolicy.ProjectName ||
                                !OfflinePolicy.SamePath(fullName, Path.Combine(Path.GetDirectoryName(OfflinePolicy.SolutionPath), OfflinePolicy.ProjectName + ".tsproj")))
                                continue;
                            dynamic projectObject = null;
                            try { projectObject = project.Object; } catch { }
                            if (projectObject == null) continue;
                            // Probe GetTargetNetId() — proves it's the live config surface.
                            try
                            {
                                var probe = projectObject.GetTargetNetId();
                                if (probe != null) { _sysManager = projectObject; return _sysManager; }
                            }
                            catch { }
                        }
                    }
                    throw new BridgeException("Configured System Manager project is not loaded yet.");
                }
                catch (BridgeException) { if (attempt >= 40) throw; System.Threading.Thread.Sleep(500); }
                catch (Exception ex)
                {
                    if (ComHelpers.IsRetryableComError(ex) && attempt < 40)
                    {
                        System.Threading.Thread.Sleep(500);
                        continue;
                    }
                    throw;
                }
            }
            throw new BridgeException("TcSysManager not available");
        }

        private static bool IsSysManagerAlive(dynamic sm)
        {
            try { var _ = sm.GetTargetNetId(); return true; }
            catch
            {
                // Some sysmanagers are the GetObject wrapper without GetTargetNetId;
                // fall back to a cheap call that always exists.
                try { var __ = sm.LookupTreeItem("TIID"); return true; } catch { return false; }
            }
        }

        public void Dispose()
        {
            try { Te1000MessageFilter.Revoke(); } catch { }
            // Release the cached proxies before dropping references so the COM RCWs
            // are torn down rather than leaked until GC.
            object sm = (object)_sysManager;
            object dte = (object)_dte;
            _sysManager = null; _dte = null;
            SafeRelease(sm);
            // Only release the DTE if WE own it (created via 'create'); an 'active'
            // DTE is the live IDE shared across the ROT, and over-releasing its RCW
            // can disturb the running IDE. We acquired our own RCW ref though, so a
            // single balanced release is correct either way — release it.
            SafeRelease(dte);
            if (_ownerMutex != null) { try { _ownerMutex.ReleaseMutex(); } catch { } _ownerMutex.Dispose(); _ownerMutex = null; }
        }
    }
}
