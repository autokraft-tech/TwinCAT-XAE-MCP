using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;

namespace Te1000Daemon
{
    // Enforced in the daemon, including for clients bypassing the MCP front.
    internal static class OfflinePolicy
    {
        public static readonly string SolutionPath = Environment.GetEnvironmentVariable("TE1000_MCP_SOLUTION_PATH");
        public static readonly string WriteSolutionPath = Environment.GetEnvironmentVariable("TE1000_WRITE_SOLUTION_PATH");
        public static readonly string SessionMode = Environment.GetEnvironmentVariable("TE1000_SESSION_MODE") ?? "active";
        public static readonly string ProgId = Environment.GetEnvironmentVariable("TE1000_PROGID") ?? "TcXaeShell.DTE.17.0";
        public static readonly string XaeVersion = Environment.GetEnvironmentVariable("TE1000_XAE_VERSION") ?? "3.1.4026.20";
        public static readonly string ProjectName = Environment.GetEnvironmentVariable("TE1000_PROJECT_NAME") ?? "MySPT_Machine";
        public static readonly string PlcRoot = Environment.GetEnvironmentVariable("TE1000_PLC_ROOT") ?? "TIPC^MainPLC^MainPLC项目";
        private static readonly string[] WriteRoots = (Environment.GetEnvironmentVariable("TE1000_WRITE_ROOTS") ?? "").Split(';');
        private static readonly string[] WriteTypes = (Environment.GetEnvironmentVariable("TE1000_PLC_WRITE_TYPES") ?? "604").Split(';');
        public static void AssertObjectType(int type)
        {
            // Each additional type still requires its own startup-pinned write permission.
            // 623 remains disabled after its single documented-array validation failed on 4026.20.
            if ((type != 604 && type != 609 && type != 606 && type != 605 && type != 615) || Array.IndexOf(WriteTypes, type.ToString()) < 0)
                throw new BridgeException("PLC object type is not enabled at daemon startup: " + type);
        }
        public static readonly HashSet<string> Actions = new HashSet<string>(StringComparer.Ordinal)
        {
            "xae_status", "xae_open_solution", "xae_save_all", "xae_get_error_list",
            "xae_solution_build", "twincat_lookup_tree_item", "twincat_list_children",
            "plc_pou_tree", "plc_pou_get_decl", "plc_pou_get_impl", "plc_pou_create",
            "plc_pou_set_decl", "plc_pou_set_impl",
            "project_changes", "project_save_preview", "project_save_audit", "project_save"
        };

        public static bool SamePath(string a, string b)
        {
            return !string.IsNullOrWhiteSpace(a) && !string.IsNullOrWhiteSpace(b) &&
                string.Equals(Path.GetFullPath(a), Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase);
        }

        private static bool Under(string path, string root)
        {
            return !string.IsNullOrEmpty(root) && (path == root || path.StartsWith(root + "^", StringComparison.Ordinal));
        }

        public static void AssertWritableSolution()
        {
            if (!SamePath(SolutionPath, WriteSolutionPath))
                throw new BridgeException("Read-only solution: saving, building and PLC writes are disabled. Configure TE1000_WRITE_SOLUTION_PATH at daemon startup.");
        }

        public static void AssertWritePath(string path)
        {
            bool code = Under(path, PlcRoot + "^03_POUs") || Under(path, PlcRoot + "^01_DUTs") || Under(path, PlcRoot + "^04_GVLs");
            if (code)
                foreach (string root in WriteRoots)
                    if (Under(path, root)) return;
            throw new BridgeException("PLC object is outside TE1000_WRITE_ROOTS: " + path);
        }

        public static void AssertMethodWritePath(string path, string owner)
        {
            AssertWritePath(path);
            if (path.Substring(0, path.LastIndexOf('^')) != owner && Array.IndexOf(WriteRoots, path) < 0)
                throw new BridgeException("Folder Methods require an exact startup-authorized object path.");
        }

        public static void Validate(string action, Json.JObj p)
        {
            if (!Actions.Contains(action)) throw new BridgeException("Disabled by offline policy: " + action);
            if (SessionMode != "active" && SessionMode != "createOnce") throw new BridgeException("TE1000_SESSION_MODE must be active or createOnce.");
            if (string.IsNullOrWhiteSpace(SolutionPath) || !Path.IsPathRooted(SolutionPath) || !File.Exists(SolutionPath))
                throw new BridgeException("TE1000_MCP_SOLUTION_PATH must name an existing absolute solution path.");
            if (p.Truthy("mode") && p.Str("mode") != SessionMode) throw new BridgeException("Session mode is fixed at daemon startup.");
            if (p.Truthy("progId") && p.Str("progId") != ProgId) throw new BridgeException("COM ProgID is fixed at daemon startup.");
            if (p.Truthy("expectedSolutionPath") && !SamePath(p.Str("expectedSolutionPath"), SolutionPath))
                throw new BridgeException("MCP front and daemon are pinned to different solutions; use separate pipe names.");
            if (action == "xae_open_solution")
            {
                if (!SamePath(p.Str("solutionPath"), SolutionPath)) throw new BridgeException("Requested solution does not match pinned solution.");
                if (p.Bool("discardChanges")) throw new BridgeException("Discarding changes is disabled.");
                if (p.Bool("closeExisting")) AssertWritableSolution();
            }
            bool write = action == "plc_pou_create" || action == "plc_pou_set_decl" || action == "plc_pou_set_impl";
            if (write || action == "xae_save_all" || action == "project_save" || action == "xae_solution_build") AssertWritableSolution();
            if (write)
            {
                string path = p.Str("path");
                if (action == "plc_pou_create")
                {
                    if (!Regex.IsMatch(p.Str("name") ?? "", @"^[A-Za-z_][A-Za-z0-9_]*$")) throw new BridgeException("Invalid PLC object name.");
                    if (p["subType"] is string || p.Str("subType") != p.Int("subType").ToString(System.Globalization.CultureInfo.InvariantCulture))
                        throw new BridgeException("subType must be an integer.");
                    // Expand only after validating the corresponding interface locally.
                    AssertObjectType(p.Int("subType"));
                    if (p.Has("language") && (p["language"] is string || p.Str("language") != "1")) throw new BridgeException("Only integer ST language 1 is enabled.");
                    if (p.Int("subType") == 609 && (p.Str("expectedHash") != "absent" || !Regex.IsMatch(p.Str("returnType") ?? "", @"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$")))
                        throw new BridgeException("Method creation requires expectedHash=absent and a PLC return type.");
                    if (p.Int("subType") != 604 && p.Int("subType") != 609 && p.Int("subType") != 623 && (p.Str("expectedHash") != "absent" || p.Has("declText")))
                        throw new BridgeException("DUT creation requires expectedHash=absent; set its declaration separately with a content hash.");
                    path = p.Str("parent") + "^" + p.Str("name");
                }
                if (p.Has("implXml") && p["implXml"] != null) throw new BridgeException("XML implementation writes are disabled; use ST text.");
                AssertWritePath(path ?? "");
            }
            if (action == "xae_solution_build" && (p.Str("action") != "build" || !p.Bool("waitForFinish", true)))
                throw new BridgeException("Only synchronous offline PLC build is enabled.");
            foreach (string key in new[] { "path", "treePath", "parent", "plcPath" })
            {
                string path = p.Str(key);
                if (string.IsNullOrEmpty(path)) continue;
                if (path != "TIPC" && path != "TIPC^MainPLC" && !Under(path, PlcRoot))
                    throw new BridgeException("Path is outside the configured PLC project: " + path);
                if (path.Split('^').Length > 64 || path.Contains("_Libraries") || path.Contains(".."))
                    throw new BridgeException("Unsupported PLC path: " + path);
            }
        }
    }
}
