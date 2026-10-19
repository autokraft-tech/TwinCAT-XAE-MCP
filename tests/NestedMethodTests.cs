using System;
using System.Collections.Generic;
using System.Reflection;
using Te1000Daemon;

internal static class NestedMethodTests
{
    private static int checks;
    private const string Root = "TIPC^MainPLC^MainPLCProject";
    private const string Fb = Root + "^03_POUs^02_Components^FB_Test";
    private static void Check(bool pass) { checks++; if (!pass) throw new Exception("Nested Method assertion failed at check " + checks); }
    private static void Reject(Action action)
    {
        bool refused = false;
        try { action(); } catch (BridgeException) { refused = true; }
        catch (TargetInvocationException ex) { refused = ex.InnerException is BridgeException; }
        Check(refused);
    }
    private static Dictionary<string, MethodTarget.Node> Chain(string path)
    {
        var nodes = new Dictionary<string, MethodTarget.Node>();
        string current = path;
        while (true)
        {
            nodes[current] = new MethodTarget.Node { Path = current, ParentPath = current.Substring(0, current.LastIndexOf('^')), Type = current == path ? 609 : current == Fb ? 604 : 601 };
            if (current == Root + "^03_POUs^02_Components") break;
            current = current.Substring(0, current.LastIndexOf('^'));
        }
        return nodes;
    }
    public static int Main()
    {
        try { return Tests(); }
        catch (Exception ex) { Console.Error.WriteLine(ex.GetType().Name + ": " + ex.Message); if (ex.InnerException != null) Console.Error.WriteLine(ex.InnerException.Message); return 1; }
    }
    private static int Tests()
    {
        string nested = Fb + "^I_Test^Inner^M_Test";
        Environment.SetEnvironmentVariable("TE1000_PLC_ROOT", Root);
        Environment.SetEnvironmentVariable("TE1000_WRITE_ROOTS", Fb + ";" + nested);
        foreach (string path in new[] { Fb + "^M_Test", Fb + "^I_Test^M_Test", nested })
        {
            var nodes = Chain(path);
            Check(MethodTarget.Resolve(path, Root, p => nodes[p]) == Fb);
        }
        foreach (int type in new[] { 604, 608, 615, 0 })
        {
            var nodes = Chain(nested); nodes[nested].Type = type;
            Reject(() => MethodTarget.Resolve(nested, Root, p => nodes[p]));
        }
        foreach (int type in new[] { 608, 609, 615, 0 })
        {
            var nodes = Chain(nested); nodes[Fb + "^I_Test"].Type = type;
            Reject(() => MethodTarget.Resolve(nested, Root, p => nodes[p]));
        }
        var wrong = Chain(nested); wrong[nested].ParentPath = Fb + "^OtherFB";
        Reject(() => MethodTarget.Resolve(nested, Root, p => wrong[p]));
        wrong = Chain(nested); wrong[Root + "^03_POUs^02_Components"].Type = 604;
        Reject(() => MethodTarget.Resolve(nested, Root, p => wrong[p]));
        wrong = Chain(nested); wrong[nested].Path = Fb + "^OtherFB^M_Test";
        Reject(() => MethodTarget.Resolve(nested, Root, p => wrong[p]));
        Reject(() => MethodTarget.Resolve("TIPC^Other^03_POUs^M_Test", Root, p => null));
        Reject(() => MethodTarget.Resolve(Root + "^03_POUs^M_Test", Root, p => new MethodTarget.Node { Path=p, Type=609, ParentPath=Root + "^03_POUs" }));
        OfflinePolicy.AssertMethodWritePath(Fb + "^M_Test", Fb); checks++;
        OfflinePolicy.AssertMethodWritePath(nested, Fb); checks++;
        Reject(() => OfflinePolicy.AssertMethodWritePath(Fb + "^I_Test^M_Test", Fb));
        Reject(() => OfflinePolicy.AssertMethodWritePath(Fb + "Other^M_Test", Fb + "Other"));
        Reject(() => OfflinePolicy.AssertMethodWritePath(nested + "^Child", Fb));
        var actions = typeof(ComWorker).Assembly.GetType("Te1000Daemon.PlcPouActions");
        var guard = actions.GetMethod("AssertImplementationWrite", BindingFlags.NonPublic | BindingFlags.Static);
        // Exercise the actual daemon guard without acquiring COM.
        var jsonType = typeof(ComWorker).Assembly.GetType("Te1000Daemon.Json+JObj");
        object payload = Activator.CreateInstance(jsonType);
        var indexer = jsonType.GetProperty("Item");
        string hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        indexer.SetValue(payload, hash, new object[] { "expectedHash" });
        guard.Invoke(null, new object[] { payload, "", 609, 1 }); checks++;
        Reject(() => guard.Invoke(null, new object[] { payload, "changed", 609, 1 }));
        Reject(() => guard.Invoke(null, new object[] { payload, "", 609, 2 }));
        indexer.SetValue(payload, null, new object[] { "expectedHash" });
        Reject(() => guard.Invoke(null, new object[] { payload, "", 609, 1 }));
        Console.WriteLine("Nested Method checks passed: " + checks + " (no COM)");
        return 0;
    }
}

