using System;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace Te1000Daemon
{
    // No Git mutation: a Dev session is bound to the reviewed checkout/branch/commit.
    internal static class GitCheckout
    {
        private static string _failure;
        private static long? _headWriteTicks;
        internal static bool SingleCheckout { get { return Environment.GetEnvironmentVariable("TE1000_GIT_WORKFLOW") == "single-checkout"; } }

        internal static void AssertWritableMode()
        {
            string workflow = Environment.GetEnvironmentVariable("TE1000_GIT_WORKFLOW");
            string root = Path.GetDirectoryName(Path.GetDirectoryName(Path.GetFullPath(OfflinePolicy.SolutionPath)));
            if ((!string.IsNullOrEmpty(workflow) && !SingleCheckout) || (Directory.Exists(Path.Combine(root, ".git")) && !SingleCheckout))
                throw new BridgeException("Primary checkout writes require explicit single-checkout branch authorization.");
            if (SingleCheckout && OfflinePolicy.SessionMode != "createOnce")
                throw new BridgeException("Single checkout Dev requires a dedicated owned createOnce session.");
            AssertPinned();
        }

        private static string Git(string directory, string arguments)
        {
            var start = new ProcessStartInfo("git", arguments) { WorkingDirectory = directory, UseShellExecute = false,
                CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8 };
            using (var process = Process.Start(start))
            {
                var output = process.StandardOutput.ReadToEndAsync();
                var error = process.StandardError.ReadToEndAsync();
                if (!process.WaitForExit(15000)) throw new BridgeException("Git identity inspection timed out; no operation permitted.");
                if (process.ExitCode != 0) throw new BridgeException("Git identity inspection failed: " + error.Result);
                return output.Result.TrimEnd('\r', '\n');
            }
        }

        internal static void AssertPinned()
        {
            if (!SingleCheckout) return;
            if (_failure != null) throw new BridgeException(_failure);
            try
            {
                string root = Environment.GetEnvironmentVariable("TE1000_GIT_CHECKOUT");
                string branch = Environment.GetEnvironmentVariable("TE1000_GIT_BRANCH");
                string head = Environment.GetEnvironmentVariable("TE1000_GIT_HEAD");
                if (string.IsNullOrWhiteSpace(root) || !Path.IsPathRooted(root) || string.IsNullOrWhiteSpace(branch) ||
                    branch.Equals("main", StringComparison.OrdinalIgnoreCase) || branch.Equals("master", StringComparison.OrdinalIgnoreCase) ||
                    string.IsNullOrWhiteSpace(head)) throw new BridgeException("Single checkout requires an explicitly pinned non-main branch and commit.");
                if (!OfflinePolicy.SamePath(Git(root, "rev-parse --show-toplevel"), root) ||
                    !OfflinePolicy.SamePath(OfflinePolicy.SolutionPath, Path.Combine(root, "MySPT_Machine", "MySPT_Machine.sln")) ||
                    !OfflinePolicy.SamePath(Git(root, "rev-parse --path-format=absolute --git-common-dir"), Path.Combine(root, ".git")) ||
                    Git(root, "symbolic-ref --quiet --short HEAD") != branch || Git(root, "rev-parse HEAD") != head)
                    throw new BridgeException("Checkout, branch, commit or solution changed; close the owned XAE normally and reauthorize before further engineering operations.");
                long ticks = File.GetLastWriteTimeUtc(Path.Combine(root, ".git", "HEAD")).Ticks;
                if (_headWriteTicks.HasValue && _headWriteTicks.Value != ticks)
                    throw new BridgeException("Git HEAD was rewritten during the XAE session; even a switch away and back requires normal shutdown and reauthorization.");
                _headWriteTicks = ticks;
                if ((File.GetAttributes(Path.Combine(root, ".git")) & FileAttributes.ReparsePoint) != 0 ||
                    (File.GetAttributes(OfflinePolicy.SolutionPath) & FileAttributes.ReparsePoint) != 0)
                    throw new BridgeException("Linked Git/solution paths are unsupported.");
                for (var directory = new DirectoryInfo(Path.GetDirectoryName(OfflinePolicy.SolutionPath)); directory != null; directory = directory.Parent)
                    if ((directory.Attributes & FileAttributes.ReparsePoint) != 0) throw new BridgeException("Linked checkout paths are unsupported.");
            }
            catch (Exception ex)
            {
                _failure = "Git session identity locked: " + ex.Message;
                throw new BridgeException(_failure);
            }
        }
    }
}
