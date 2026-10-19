using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using Te1000Daemon;

// Pure filesystem fixtures, never an XAE project. COM effects are explicitly simulated.
namespace Te1000Daemon
{
    internal static class OfflinePolicy
    {
        public static string SolutionPath;
        public static string PlcRoot = "TIPC^MainPLC^MainPLCProject";
    }
    public sealed class BridgeException : Exception { public BridgeException(string text) : base(text) { } }
}

internal static class ProjectSaveAuditTests
{
    private const string Project = "<Project TargetNetId='1.2.3.4.5.6' ProjectGUID='project-guid' TcVersion='3.1.4026.20'><Plc GUID='plc-guid' TmcHash='old'/><Task Runtime='851'/><EtherCAT AmsNetId='target'/></Project>";
    private const string Pou = "<TcPlcObject><POU Name='FB_Test' Id='{01234567-0123-0123-0123-012345678901}'><Declaration>FUNCTION_BLOCK FB_Test</Declaration><Implementation><ST>value := 1;</ST></Implementation></POU></TcPlcObject>";
    private static string _dir;
    private static int _checks;
    private static void Check(bool pass, string message) { _checks++; if (!pass) throw new Exception(message); }
    private static void Git(string args)
    {
        var start = new ProcessStartInfo("git", args) { WorkingDirectory = _dir, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        using (var p = Process.Start(start)) { p.StandardOutput.ReadToEnd(); string error = p.StandardError.ReadToEnd(); p.WaitForExit(); if (p.ExitCode != 0) throw new Exception(error); }
    }
    private static void Write(string file, string text) { File.WriteAllText(Path.Combine(_dir, file), text, new UTF8Encoding(false)); }
    private static void Reject(Action action, string reason)
    {
        bool rejected = false; try { action(); } catch (BridgeException) { rejected = true; } Check(rejected, reason);
    }
    private static ProjectSaveAudit Fixture()
    {
        _dir = Path.Combine(Path.GetTempPath(), "nexplc-save-audit-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(_dir, "MainPLC", "03_POUs"));
        OfflinePolicy.SolutionPath = Path.Combine(_dir, "fixture.sln");
        Write("fixture.sln", "save audit test fixture; never opened by XAE");
        Write("fixture.tsproj", Project);
        Write("MainPLC/MainPLC.plcproj", "<Project><PropertyGroup><ProjectGuid>plc-guid</ProjectGuid></PropertyGroup><ItemGroup><Compile Include='03_POUs\\FB_Test.TcPOU'/></ItemGroup></Project>");
        Write("MainPLC/03_POUs/FB_Test.TcPOU", Pou);
        Git("init -q"); Git("add .");
        // Only a disposable fixture repository receives this setup commit.
        Git("-c user.name=Fixture -c user.email=fixture@invalid -c core.hooksPath=NUL commit -q -m fixture");
        return new ProjectSaveAudit(OfflinePolicy.SolutionPath);
    }
    private static void Cleanup()
    {
        // Delete only this test's verified absolute temporary directory.
        string root = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (_dir != null && Path.GetFullPath(_dir).StartsWith(root, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(_dir).StartsWith("nexplc-save-audit-test-", StringComparison.Ordinal))
        {
            foreach (string file in Directory.GetFiles(_dir, "*", SearchOption.AllDirectories)) File.SetAttributes(file, FileAttributes.Normal);
            Directory.Delete(_dir, true);
        }
    }
    private static void Run(Action<ProjectSaveAudit> test) { var audit = Fixture(); try { test(audit); } finally { Cleanup(); } }
    private static void Begin(ProjectSaveAudit audit) { audit.BeforeObjectWrite(OfflinePolicy.PlcRoot + "^03_POUs^FB_Test", false); }

    public static int Main()
    {
        try { return Tests(); }
        catch (Exception ex) { Console.Error.WriteLine(ex); return 1; }
    }
    private static int Tests()
    {
        foreach (string folder in new[] { "", "I_Test\\", "I_Test\\Inner\\" })
        {
            foreach (string fault in new[] { "none", "guid", "invalid-guid", "folder", "parent", "reference" })
                Run(audit => {
                    string id = fault == "invalid-guid" ? "invalid" : "{11111111-0123-0123-0123-012345678901}";
                    string method = "<Method Name='M_Test' Id='" + id + "' FolderPath='" + folder + "'><Declaration>METHOD M_Test : DINT</Declaration><Implementation><ST>M_Test := 1;</ST></Implementation></Method>";
                    string source = Pou.Replace("</POU>", method + "</POU>");
                    Write("MainPLC/03_POUs/FB_Test.TcPOU", source); Git("add .");
                    Git("-c user.name=Fixture -c user.email=fixture@invalid -c core.hooksPath=NUL commit -q -m method");
                    string owner = OfflinePolicy.PlcRoot + "^03_POUs^FB_Test";
                    string target = owner + "^" + folder.Replace('\\', '^') + "M_Test";
                    audit.BeforeObjectWrite(target, false, 609, owner);
                    Action save = () => {
                        string changed = source.Replace("M_Test := 1", "M_Test := 2");
                        if (fault == "guid") changed = changed.Replace("11111111", "22222222");
                        if (fault == "folder") changed = changed.Replace("FolderPath='" + folder + "'", "FolderPath='Other\\'");
                        if (fault == "parent") changed = changed.Replace("value := 1", "value := 9");
                        if (fault == "reference") Write("MainPLC/MainPLC.plcproj", "<Project><ItemGroup><Compile Include='M_Test.TcPOU'/></ItemGroup></Project>");
                        Write("MainPLC/03_POUs/FB_Test.TcPOU", changed);
                    };
                    if (fault == "none") Check(audit.Save(save).Bool("safe"), "Method code in exact folder must pass");
                    else Reject(() => audit.Save(save), "Method identity/owner/reference fault must lock: " + fault);
                });
        }
        Run(audit => {
            Begin(audit);
            var report = audit.Save(() => { Write("MainPLC/03_POUs/FB_Test.TcPOU", Pou.Replace("value := 1", "value := 2")); Write("fixture.tsproj", Project.Replace("TmcHash='old'", "TmcHash='new'")); });
            Check(report.Bool("safe"), "POU + TmcHash change must pass");
            Check(report.Arr("changes").Count == 2, "all changed files must be reported");
            Check(((Json.JObj)report.Arr("changes")[0]).Has("beforeText"), "complete before/after content must be retained");
            Check(!audit.Changes().Bool("blocked"), "safe save must not lock session");
        });
        foreach (string field in new[] { "TargetNetId='1.2.3.4.5.6'", "ProjectGUID='project-guid'", "TcVersion='3.1.4026.20'", "GUID='plc-guid'", "Runtime='851'", "AmsNetId='target'" })
            Run(audit => {
                Begin(audit); Reject(() => audit.Save(() => Write("fixture.tsproj", Project.Replace(field, field.Replace("='", "='changed-")))), field + " must fail save");
                Check(!audit.Report().Bool("safe", true), "unsafe save must never return normal success");
                Reject(() => Begin(audit), "unsafe save must block later writes");
                Reject(() => new ProjectSaveAudit(OfflinePolicy.SolutionPath).AssertUnblocked(), "daemon restart must retain lock");
            });
        Run(audit => {
            Write("MainPLC/03_POUs/FB_Test.TcPOU", Pou + "user edit");
            Reject(() => Begin(audit), "pre-existing user changes must be refused");
            Check(File.ReadAllText(Path.Combine(_dir, "MainPLC/03_POUs/FB_Test.TcPOU")).EndsWith("user edit"), "user changes must be untouched");
        });
        Run(audit => {
            Begin(audit); Write("fixture.tsproj", Project.Replace("project-guid", "user-guid"));
            int saves = 0; Reject(() => audit.Save(() => saves++), "external concurrent change must block save before COM");
            Check(saves == 0, "preflight must prevent COM save on changed files");
            Check(File.ReadAllText(Path.Combine(_dir, "fixture.tsproj")).Contains("user-guid"), "concurrent user change must remain");
        });
        Run(audit => { Begin(audit); Reject(() => new ProjectSaveAudit(OfflinePolicy.SolutionPath).AssertUnblocked(), "unfinished edit must block restart"); });
        Run(audit => {
            Begin(audit);
            Write("MainPLC/03_POUs/FB_Test.TcPOU", Pou.Replace("value := 1", "value := 2"));
            audit.AfterObjectWrite(); // Some XAE operations write to disk before SaveAll.
            Begin(audit);
            Check(audit.Save(() => { }).Bool("safe"), "immediate known object writes must not look like external edits");
        });
        Run(audit => {
            audit.BeforeObjectWrite(OfflinePolicy.PlcRoot + "^03_POUs^FB_New", true);
            Write("MainPLC/03_POUs/FB_New.TcPOU", Pou.Replace("FB_Test", "FB_New"));
            audit.AfterObjectWrite();
            var report = audit.Save(() => {
                Write("MainPLC/MainPLC.plcproj", "<Project>\n  <PropertyGroup><ProjectGuid>plc-guid</ProjectGuid></PropertyGroup>\n  <ItemGroup>\n    <Compile Include='03_POUs\\FB_Test.TcPOU'/>\n    <Compile Include='03_POUs\\FB_New.TcPOU'><SubType>Code</SubType></Compile>\n  </ItemGroup>\n</Project>");
            });
            Check(report.Bool("safe"), "whitespace around an XAE-created Compile reference must not be critical metadata");
        });
        Run(audit => {
            Begin(audit);
            try { audit.Save(() => { throw new Exception("simulated COM failure"); }); } catch (Exception ex) { Check(ex.Message == "simulated COM failure", "COM failure must propagate"); }
            Reject(() => audit.AssertUnblocked(), "COM failure must lock later work");
        });
        Run(audit => {
            string method = "<Method Name='M_Test' Id='{11111111-0123-0123-0123-012345678901}'><Declaration>METHOD PUBLIC M_Test : DINT</Declaration><Implementation><ST>M_Test := 1;</ST></Implementation></Method>";
            string withMethod = Pou.Replace("</POU>", method + "</POU>");
            audit.BeforeObjectWrite(OfflinePolicy.PlcRoot + "^03_POUs^FB_Test^M_Test", true, 609);
            Write("MainPLC/03_POUs/FB_Test.TcPOU", withMethod); audit.AfterObjectWrite();
            Check(audit.Save(() => { }).Bool("safe"), "known nested Method creation must pass without a project reference");
            audit.BeforeObjectWrite(OfflinePolicy.PlcRoot + "^03_POUs^FB_Test^M_Test", false, 609);
            Reject(() => audit.Save(() => Write("MainPLC/03_POUs/FB_Test.TcPOU", withMethod.Replace("value := 1", "value := 999"))), "Method authorization must not allow parent FB code edits");
        });
        Run(audit => { Begin(audit); Reject(() => audit.Save(() => Write("MainPLC/03_POUs/FB_Test.TcPOU", Pou.Replace("01234567", "ffffffff"))), "GUID mutation must fail"); });
        Run(audit => {
            audit.BeforeObjectWrite(OfflinePolicy.PlcRoot + "^01_DUTs^ST_New", true, 606);
            Directory.CreateDirectory(Path.Combine(_dir, "MainPLC/01_DUTs"));
            Write("MainPLC/01_DUTs/ST_New.TcDUT", "<TcPlcObject><DUT Name='ST_New' Id='{22222222-0123-0123-0123-012345678901}'><Declaration>TYPE ST_New : STRUCT n : DINT; END_STRUCT END_TYPE</Declaration></DUT></TcPlcObject>");
            audit.AfterObjectWrite();
            Check(audit.Save(() => Write("MainPLC/MainPLC.plcproj", "<Project><PropertyGroup><ProjectGuid>plc-guid</ProjectGuid></PropertyGroup><ItemGroup><Compile Include='03_POUs\\FB_Test.TcPOU'/><Compile Include='01_DUTs\\ST_New.TcDUT'/></ItemGroup></Project>")).Bool("safe"), "known DUT and its unique project reference must pass");
        });
        Run(audit => { Begin(audit); Reject(() => audit.Save(() => Write("MainPLC/MainPLC.plcproj", "<Project><PropertyGroup><ProjectGuid>changed</ProjectGuid></PropertyGroup></Project>")), "PLC project metadata must fail"); });
        Run(audit => {
            audit.BeforeObjectWrite(OfflinePolicy.PlcRoot + "^04_GVLs^GVL_New", true, 615);
            Directory.CreateDirectory(Path.Combine(_dir, "MainPLC/04_GVLs"));
            string gvl = "<TcPlcObject><GVL Name='GVL_New' Id='{33333333-0123-0123-0123-012345678901}'><Declaration>VAR_GLOBAL n : DINT; END_VAR</Declaration></GVL></TcPlcObject>";
            Write("MainPLC/04_GVLs/GVL_New.TcGVL", gvl); audit.AfterObjectWrite();
            Check(audit.Save(() => Write("MainPLC/MainPLC.plcproj", "<Project><PropertyGroup><ProjectGuid>plc-guid</ProjectGuid></PropertyGroup><ItemGroup><Compile Include='03_POUs\\FB_Test.TcPOU'/><Compile Include='04_GVLs\\GVL_New.TcGVL'><LinkAlways>true</LinkAlways></Compile></ItemGroup></Project>")).Bool("safe"), "GVL GUID and unique reference with LinkAlways must pass");
            audit.BeforeObjectWrite(OfflinePolicy.PlcRoot + "^04_GVLs^GVL_New", false, 615);
            Reject(() => audit.Save(() => Write("MainPLC/04_GVLs/GVL_New.TcGVL", gvl.Replace("33333333", "44444444"))), "GVL GUID change must lock");
        });
        Run(audit => {
            Begin(audit);
            audit.Save(() => Write("MainPLC/03_POUs/FB_Test.TcPOU", Pou.Replace("value := 1", "value := 2")));
            var recovered = new ProjectSaveAudit(OfflinePolicy.SolutionPath);
            Check(recovered.Recovered, "completed audited save must recover with exact disk and Git state");
            Check(recovered.Report().Bool("recovered"), "recovered report must identify recovery");
            Begin(recovered);
            Check(recovered.Save(() => Write("MainPLC/03_POUs/FB_Test.TcPOU", Pou.Replace("value := 1", "value := 3"))).Bool("safe"), "recovered uncommitted worktree must support audited editing");
        });
        Run(audit => {
            Begin(audit); audit.Save(() => Write("MainPLC/03_POUs/FB_Test.TcPOU", Pou.Replace("value := 1", "value := 2")));
            Write("fixture.tsproj", Project.Replace("project-guid", "external-guid"));
            Reject(() => new ProjectSaveAudit(OfflinePolicy.SolutionPath).AssertUnblocked(), "disk divergence must lock recovery");
        });
        Run(audit => {
            Begin(audit); audit.Save(() => { });
            Environment.SetEnvironmentVariable("TE1000_WRITE_ROOTS", "changed-policy");
            try { Reject(() => new ProjectSaveAudit(OfflinePolicy.SolutionPath).AssertUnblocked(), "startup scope divergence must lock recovery"); }
            finally { Environment.SetEnvironmentVariable("TE1000_WRITE_ROOTS", null); }
        });
        Run(audit => {
            Begin(audit); audit.Save(() => { }); Begin(audit);
            Reject(() => new ProjectSaveAudit(OfflinePolicy.SolutionPath).AssertUnblocked(), "pending journal must dominate older completed baseline");
            Reject(() => audit.AssertCanCloseOrCreate(), "unsaved edits must block lifecycle stop/create");
        });
        Run(audit => {
            Begin(audit); var saved = audit.Save(() => { });
            File.AppendAllText(saved.Str("archive"), "corruption");
            Reject(() => new ProjectSaveAudit(OfflinePolicy.SolutionPath).AssertUnblocked(), "altered immutable archive must lock recovery");
        });
        Run(audit => {
            Begin(audit); var saved = audit.Save(() => Write("MainPLC/03_POUs/FB_Test.TcPOU", Pou.Replace("value := 1", "value := 2")));
            string baseline = Path.Combine(Path.GetDirectoryName(saved.Str("archive")), "baseline.json");
            File.Move(baseline, baseline + ".fixture-missing");
            var restarted = new ProjectSaveAudit(OfflinePolicy.SolutionPath);
            Check(!restarted.Recovered, "saved without baseline is not recovered");
            Reject(() => Begin(restarted), "saved dirty files without baseline must not be adopted");
            Reject(() => restarted.AssertCanCloseOrCreate(), "no baseline must block lifecycle creation on dirty files");
        });
        Run(audit => {
            Begin(audit); audit.Save(() => Write("MainPLC/03_POUs/FB_Test.TcPOU", Pou.Replace("value := 1", "value := 2")));
            audit.Build(() => { });
            var restarted = new ProjectSaveAudit(OfflinePolicy.SolutionPath);
            Check(!restarted.Recovered, "build does not establish a saved recovery baseline");
            Reject(() => Begin(restarted), "build requires subsequent audited SaveAll before restart editing");
        });
        Console.WriteLine("save audit fixture tests passed (" + _checks + " checks; no COM or PLC files accessed)");
        return 0;
    }
}
