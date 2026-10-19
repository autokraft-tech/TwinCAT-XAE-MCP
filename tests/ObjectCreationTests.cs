using System;
using System.Reflection;
using Te1000Daemon;

// Examines the actual daemon builder without acquiring DTE or opening XAE.
internal static class ObjectCreationTests
{
    public static int Main()
    {
        var type = typeof(ComWorker).Assembly.GetType("Te1000Daemon.PlcPouActions", true);
        var builder = type.GetMethod("BuildVInfo", BindingFlags.Static | BindingFlags.NonPublic);
        foreach (string declaration in new string[] { null, "TYPE T_Disabled : DINT;\nEND_TYPE\n" })
        {
            bool rejected = false;
            try { builder.Invoke(null, new object[] { 623, 1, null, null, null, declaration }); }
            catch (TargetInvocationException ex) { rejected = ex.InnerException is BridgeException; }
            if (!rejected) throw new Exception("ALIAS must be rejected by the internal builder before COM.");
        }
        var fb = builder.Invoke(null, new object[] { 604, 1, null, null, null, null }) as object[];
        if (fb == null || fb.Length != 1 || (int)fb[0] != 1) throw new Exception("FB creation language regression.");
        Console.WriteLine("object creation checks passed (ALIAS builder rejected; FB language preserved; no COM)");
        return 0;
    }
}
