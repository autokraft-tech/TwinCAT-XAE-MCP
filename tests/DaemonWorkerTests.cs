using System;
using System.Reflection;
using System.IO;
using System.Threading;
using Te1000Daemon;

// Deterministic, COM-free coverage of serialization and fail-stop on timeout.
internal static class DaemonWorkerTests
{
    private static readonly MethodInfo RunMethod = typeof(ComWorker).GetMethod("Run", BindingFlags.Instance | BindingFlags.NonPublic);
    private static object Run(ComWorker worker, Func<Json.JObj> job, int timeout)
    { return RunMethod.Invoke(worker, new object[] { job, timeout }); }
    private static bool Ok(object result)
    { return (bool)result.GetType().GetField("Ok").GetValue(result); }
    private static void Check(bool condition, string message)
    { if (!condition) throw new Exception(message); }

    public static int Main()
    {
        string fixture = Path.GetTempFileName();
        try
        {
            Environment.SetEnvironmentVariable("TE1000_MCP_SOLUTION_PATH", fixture);
            Environment.SetEnvironmentVariable("TE1000_WRITE_SOLUTION_PATH", "");
            Environment.SetEnvironmentVariable("TE1000_SESSION_MODE", "active");
            var policy = typeof(ComWorker).Assembly.GetType("Te1000Daemon.OfflinePolicy");
            foreach (string action in new[] { "xae_save_all", "xae_solution_build", "plc_pou_create", "plc_pou_set_decl", "plc_pou_set_impl" })
            {
                bool rejected = false;
                try { policy.GetMethod("Validate").Invoke(null, new object[] { action, new Json.JObj() }); }
                catch (TargetInvocationException ex) { rejected = ex.InnerException.Message.StartsWith("Read-only solution:"); }
                Check(rejected, "read-only daemon must reject " + action + " before COM");
            }
        }
        finally { File.Delete(fixture); }
        using (var worker = new ComWorker(null, 1000, 0))
        {
            int staId = 0;
            for (int i = 0; i < 20; i++)
            {
                var result = Run(worker, delegate
                {
                    Check(Thread.CurrentThread.GetApartmentState() == ApartmentState.STA, "COM jobs must run in STA");
                    int current = Thread.CurrentThread.ManagedThreadId;
                    if (staId == 0) staId = current;
                    Check(current == staId, "requests must reuse the same STA thread");
                    return new Json.JObj();
                }, 1000);
                Check(Ok(result), "STA job failed");
            }
        }
        using (var worker = new ComWorker(null, 1000, 0))
        using (var unblock = new ManualResetEventSlim(false))
        {
            int calls = 0;
            var timeout = Run(worker, delegate { Interlocked.Increment(ref calls); unblock.Wait(2000); return new Json.JObj(); }, 100);
            Check(!Ok(timeout), "wedged job must time out");
            var refused = Run(worker, delegate { Interlocked.Increment(ref calls); return new Json.JObj(); }, 1000);
            Check(!Ok(refused), "worker must refuse work after an indeterminate call");
            unblock.Set();
            Thread.Sleep(100);
            Check(calls == 1, "timed-out job must not be replayed and no second worker may execute");
        }
        Console.WriteLine("worker tests passed (5 read-only policy rejections; 20 same-STA jobs; timeout blocks later work)");
        return 0;
    }
}
