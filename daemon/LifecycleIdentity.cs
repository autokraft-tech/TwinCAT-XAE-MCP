using System;
using System.Diagnostics;
using System.IO;
using System.Security.Principal;
using System.Text;

namespace Te1000Daemon
{
    internal static class LifecycleIdentity
    {
        internal static string PipeName = null;
        internal static string UserSid { get { return WindowsIdentity.GetCurrent().User.Value; } }
        internal static int SessionId { get { return Process.GetCurrentProcess().SessionId; } }
        internal static string PolicyHash
        {
            get
            {
                var text = new StringBuilder();
                foreach (string key in new[] { "TE1000_MCP_SOLUTION_PATH", "TE1000_WRITE_SOLUTION_PATH", "TE1000_WRITE_ROOTS", "TE1000_PLC_WRITE_TYPES", "TE1000_SESSION_MODE", "TE1000_PROGID", "TE1000_XAE_VERSION", "TE1000_PROJECT_NAME", "TE1000_PLC_ROOT" })
                    text.Append(key).Append('=').Append(Environment.GetEnvironmentVariable(key)).Append('\n');
                return ProjectSaveAudit.Hash(Encoding.UTF8.GetBytes(text.ToString()));
            }
        }
        internal static Json.JObj Info()
        {
            using (var process = Process.GetCurrentProcess())
                return new Json.JObj().Set("daemonPid", process.Id).Set("daemonStartTicks", process.StartTime.ToUniversalTime().Ticks.ToString())
                    .Set("userSid", UserSid).Set("sessionId", SessionId).Set("pipe", PipeName)
                    .Set("solution", OfflinePolicy.SolutionPath).Set("policyHash", PolicyHash)
                    .Set("executable", process.MainModule.FileName);
        }
        internal static void AssertStartupSession()
        {
            string sid = Environment.GetEnvironmentVariable("TE1000_OWNER_SID");
            string session = Environment.GetEnvironmentVariable("TE1000_OWNER_SESSION_ID");
            if ((sid != null && sid != UserSid) || (session != null && session != SessionId.ToString()) || SessionId == 0)
                throw new BridgeException("Daemon user/session differs from startup profile; no XAE acquisition permitted.");
        }
    }
}
