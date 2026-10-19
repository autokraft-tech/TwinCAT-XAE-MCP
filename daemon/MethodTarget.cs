using System;

namespace Te1000Daemon
{
    // Metadata only: the caller reads each node and its actual Parent on the STA.
    internal static class MethodTarget
    {
        internal sealed class Node
        {
            public string Path;
            public string ParentPath;
            public int Type;
        }

        internal static string Resolve(string path, string plcRoot, Func<string, Node> read)
        {
            string prefix = plcRoot + "^03_POUs^";
            if (!path.StartsWith(prefix, StringComparison.Ordinal) || path.Split('^').Length > 64)
                throw new BridgeException("Method is outside the configured POUs.");
            string current = path;
            bool target = true;
            string owner = null;
            while (current.StartsWith(prefix, StringComparison.Ordinal))
            {
                Node node = read(current);
                if (node == null || node.Path != current)
                    throw new BridgeException("Method tree identity mismatch.");
                if (!target && owner == null && node.Type == 604) owner = current;
                else if (node.Type != (target ? 609 : 601))
                    throw new BridgeException("Method ancestry must contain only PLC folders up to its owning FB.");
                string parent = current.Substring(0, current.LastIndexOf('^'));
                if (node.ParentPath != parent)
                    throw new BridgeException("Method parent does not match the requested path.");
                current = parent;
                target = false;
            }
            if (owner == null) throw new BridgeException("Method has no owning FB inside the configured POUs.");
            return owner;
        }
    }
}
