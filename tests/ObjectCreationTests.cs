using System;
using System.Reflection;
using Te1000Daemon;

// Examines the actual daemon builder without acquiring DTE or opening XAE.
internal static class ObjectCreationTests
{
    public static int Main(string[] args)
    {
        var type = typeof(ComWorker).Assembly.GetType("Te1000Daemon.PlcPouActions", true);
        var builder = type.GetMethod("BuildVInfo", BindingFlags.Static | BindingFlags.NonPublic);
        string declaration = "TYPE T_P2Resume : DINT;\nEND_TYPE\n";
        object info = builder.Invoke(null, new object[] { 623, 1, null, null, null, declaration });
        if (args.Length == 1 && args[0] == "--observe")
        {
            Console.WriteLine("Observed ALIAS builder CLR type: " + (info == null ? "null" : info.GetType().FullName));
            return 0;
        }
        var array = info as object[];
        if (array == null || array.Length != 1 || !(array[0] is string) || (string)array[0] != declaration)
            throw new Exception("ALIAS vInfo must be a single-element object[] containing the exact declaration.");
        var fb = builder.Invoke(null, new object[] { 604, 1, null, null, null, null }) as object[];
        if (fb == null || fb.Length != 1 || (int)fb[0] != 1) throw new Exception("FB creation language regression.");
        Console.WriteLine("candidate marshalling checks passed (ALIAS array/exact text; FB language; no COM; NOT proof of ALIAS API support)");
        return 0;
    }
}
