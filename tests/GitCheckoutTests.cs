using System;
using System.Diagnostics;
using System.IO;
using Te1000Daemon;

internal static class GitCheckoutTests
{
    private static string root;
    private static string Git(string args)
    {
        var start = new ProcessStartInfo("git", args) { WorkingDirectory=root, UseShellExecute=false, CreateNoWindow=true, RedirectStandardOutput=true, RedirectStandardError=true };
        using (var process = Process.Start(start))
        {
            string output = process.StandardOutput.ReadToEnd(); string error = process.StandardError.ReadToEnd(); process.WaitForExit();
            if (process.ExitCode != 0) throw new Exception(error);
            return output.TrimEnd('\r','\n');
        }
    }
    private static void Reject(Action action)
    {
        try { action(); } catch (BridgeException) { return; }
        throw new Exception("Expected session identity refusal.");
    }
    public static int Main(string[] args)
    {
        try
        {
            root = Path.Combine(Path.GetTempPath(), "nexplc-checkout-fixture-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(root,"MySPT_Machine"));
            string solution = Path.Combine(root,"MySPT_Machine","MySPT_Machine.sln");
            File.WriteAllText(solution,"Synthetic fixture, never opened in XAE.");
            Git("init -q -b fixture-base"); Git("add ."); Git("-c user.name=Fixture -c user.email=fixture@invalid -c core.hooksPath=NUL commit -q -m fixture");
            Git("switch -q -c fix/fixture");
            Environment.SetEnvironmentVariable("TE1000_MCP_SOLUTION_PATH",solution);
            Environment.SetEnvironmentVariable("TE1000_WRITE_SOLUTION_PATH",solution);
            Environment.SetEnvironmentVariable("TE1000_SESSION_MODE","createOnce");
            Environment.SetEnvironmentVariable("TE1000_GIT_WORKFLOW","single-checkout");
            Environment.SetEnvironmentVariable("TE1000_GIT_CHECKOUT",root);
            Environment.SetEnvironmentVariable("TE1000_GIT_BRANCH","fix/fixture");
            Environment.SetEnvironmentVariable("TE1000_GIT_HEAD",Git("rev-parse HEAD"));
            string scenario = args[0];
            if (scenario=="main") { Git("switch -q -c main"); Environment.SetEnvironmentVariable("TE1000_GIT_BRANCH","main"); Reject(GitCheckout.AssertPinned); }
            else if (scenario=="detached") { Git("checkout -q --detach"); Reject(GitCheckout.AssertPinned); }
            else if (scenario=="root") { Environment.SetEnvironmentVariable("TE1000_GIT_CHECKOUT",Path.Combine(root,"MySPT_Machine")); Reject(GitCheckout.AssertPinned); }
            else if (scenario=="solution") { Environment.SetEnvironmentVariable("TE1000_MCP_SOLUTION_PATH",Path.Combine(root,"other.sln")); Reject(GitCheckout.AssertPinned); }
            else if (scenario=="unconfigured") { Environment.SetEnvironmentVariable("TE1000_GIT_WORKFLOW",null); Reject(GitCheckout.AssertWritableMode); }
            else if (scenario=="active") { Environment.SetEnvironmentVariable("TE1000_SESSION_MODE","active"); Reject(GitCheckout.AssertWritableMode); }
            else
            {
                GitCheckout.AssertWritableMode();
                if (scenario=="branch") { Git("switch -q -c fix/other"); Reject(GitCheckout.AssertPinned); Git("switch -q fix/fixture"); Reject(GitCheckout.AssertPinned); }
                else if (scenario=="head") { Git("-c user.name=Fixture -c user.email=fixture@invalid -c core.hooksPath=NUL commit -q --allow-empty -m changed"); Reject(GitCheckout.AssertPinned); }
                else if (scenario=="return") { Git("switch -q -c fix/temporary"); Git("switch -q fix/fixture"); Reject(GitCheckout.AssertPinned); }
                else if (scenario!="valid") throw new Exception("Unknown fixture scenario.");
            }
            Console.WriteLine("Git checkout guard passed: " + scenario + " (no COM)");
            return 0;
        }
        catch (Exception ex) { Console.Error.WriteLine(ex); return 1; }
    }
}
