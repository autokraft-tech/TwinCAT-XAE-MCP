using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;

namespace Te1000Daemon
{
    // STA-owned, fail-closed save journal. It never restores or rewrites engineering XML.
    internal sealed class ProjectSaveAudit
    {
        private readonly string _root;
        private readonly string _journal;
        private readonly string _baseline;
        internal bool Recovered { get; private set; }
        private Dictionary<string, byte[]> _before;
        private Dictionary<string, byte[]> _last;
        private Dictionary<string, byte[]> _checkpoint;
        private readonly HashSet<string> _expected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _created = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, string> _newIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, HashSet<string>> _methods = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _newMethods = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private string _blocked;
        private Json.JObj _report;

        public ProjectSaveAudit(string solution)
        {
            _root = Path.GetDirectoryName(Path.GetFullPath(solution));
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NexPlcXaeMcp", "save-audits", Hash(Encoding.UTF8.GetBytes(_root.ToUpperInvariant())));
            Directory.CreateDirectory(dir);
            _journal = Path.Combine(dir, "pending.json");
            _baseline = Path.Combine(dir, "baseline.json");
            if (File.Exists(_journal)) _blocked = "An unfinished or unsafe save journal exists: " + _journal + ". Inspect it; do not replay writes.";
            else if (File.Exists(_baseline))
            {
                try
                {
                    var baseline = Json.ParseObject(File.ReadAllText(_baseline));
                    string archive = baseline.Str("archive");
                    if (Path.GetDirectoryName(Path.GetFullPath(archive)) != dir || Hash(File.ReadAllBytes(archive)) != baseline.Str("archiveHash"))
                        throw new BridgeException("Recovery archive identity/hash mismatch.");
                    var report = Json.ParseObject(File.ReadAllText(archive));
                    var snapshot = Snapshot();
                    if (baseline.Str("policyHash") != LifecycleIdentity.PolicyHash || baseline.Str("solution") != Path.GetFullPath(solution) ||
                        baseline.Str("gitHead") != Git("rev-parse", "HEAD") || baseline.Str("gitStatus") != Git("status", "--porcelain=v1", "--untracked-files=all") ||
                        baseline.Str("gitDiffHash") != Hash(Encoding.UTF8.GetBytes(Git("diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--", "."))) ||
                        report.Str("solution") != Path.GetFullPath(solution) || report.Str("state") != "completed_and_audited" || !report.Bool("safe") || !report.Bool("saved") ||
                        Json.Write(Hashes(snapshot)) != Json.Write(report.Obj("afterHashes")))
                        throw new BridgeException("Saved recovery baseline does not match policy, Git or engineering files.");
                    _last = snapshot; _report = report; Recovered = true;
                }
                catch (Exception ex) { _blocked = "Recovery locked: " + ex.Message; }
            }
        }

        public static string Hash(byte[] bytes)
        {
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }

        private string Git(params string[] args)
        {
            // All arguments are fixed by this class; caller strings never enter a command line.
            var start = new ProcessStartInfo("git", string.Join(" ", args));
            start.WorkingDirectory = _root;
            start.UseShellExecute = false; start.CreateNoWindow = true;
            start.RedirectStandardOutput = true; start.RedirectStandardError = true;
            start.StandardOutputEncoding = Encoding.UTF8;
            using (var process = Process.Start(start))
            {
                var error = process.StandardError.ReadToEndAsync();
                var output = process.StandardOutput.ReadToEndAsync();
                if (!process.WaitForExit(15000)) throw new BridgeException("Git inspection timed out; no save permitted.");
                if (process.ExitCode != 0) throw new BridgeException("Git inspection failed: " + error.Result);
                return output.Result;
            }
        }

        private static bool EngineeringFile(string file)
        {
            string ext = Path.GetExtension(file).ToLowerInvariant();
            return ext.StartsWith(".tc") || new[] { ".sln", ".tsproj", ".plcproj", ".xti", ".tsm", ".xml" }.Contains(ext);
        }

        private Dictionary<string, byte[]> Snapshot()
        {
            var files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
            Scan(_root, files);
            foreach (string relative in Git("ls-files", "-z", "--cached", "--", ".").Split('\0'))
            {
                if (relative.Length == 0) continue;
                string file = Path.GetFullPath(Path.Combine(_root, relative));
                if (!file.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new BridgeException("Tracked path escapes solution directory.");
                if (File.Exists(file)) files[relative.Replace('/', Path.DirectorySeparatorChar)] = File.ReadAllBytes(file);
            }
            return files;
        }

        private void Scan(string dir, Dictionary<string, byte[]> files)
        {
            if ((File.GetAttributes(dir) & FileAttributes.ReparsePoint) != 0) throw new BridgeException("Linked engineering directory is not supported: " + dir);
            foreach (string file in Directory.GetFiles(dir))
            {
                if (!EngineeringFile(file)) continue;
                if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new BridgeException("Linked engineering file is not supported: " + file);
                files.Add(file.Substring(_root.Length + 1), File.ReadAllBytes(file));
            }
            foreach (string sub in Directory.GetDirectories(dir))
                if (!new[] { ".git", ".vs", "_boot", "_compileinfo", "_libraries", "_generated", "bin", "obj" }.Contains(Path.GetFileName(sub).ToLowerInvariant())) Scan(sub, files);
        }

        private static bool Equal(Dictionary<string, byte[]> a, Dictionary<string, byte[]> b)
        {
            return a.Count == b.Count && a.All(x => b.ContainsKey(x.Key) && Hash(x.Value) == Hash(b[x.Key]));
        }

        public void AssertUnblocked()
        {
            if (_blocked != null) throw new BridgeException("Save safety lock: " + _blocked);
        }

        internal void AssertCanCloseOrCreate()
        {
            AssertUnchanged();
            if (_before != null) throw new BridgeException("Pending edit batch; save and audit before lifecycle operation.");
            if (_report != null && !_report.Bool("saved")) throw new BridgeException("Audited SaveAll is required after build before lifecycle operation.");
            if (_last == null && !string.IsNullOrWhiteSpace(Git("status", "--porcelain=v1", "--untracked-files=all")))
                throw new BridgeException("No recoverable audited baseline for dirty worktree; lifecycle operation refused.");
        }

        private void AssertUnchanged()
        {
            AssertUnblocked();
            var expected = _checkpoint ?? _last;
            if (expected != null && !Equal(expected, Snapshot()))
            {
                Block("Engineering files changed outside this edit batch; preserve user changes and inspect before proceeding.");
                throw new BridgeException(_blocked);
            }
        }

        private void Begin()
        {
            AssertUnchanged();
            if (_before != null) return;
            string status = Git("status", "--porcelain=v1", "--untracked-files=all");
            if (_last == null && !string.IsNullOrWhiteSpace(status))
                throw new BridgeException("First write requires a clean isolated Git worktree; existing user changes will not be overwritten. " + status);
            _before = Snapshot();
            _checkpoint = _before;
            _report = new Json.JObj().Set("state", "pending").Set("gitStatusBefore", status).Set("solution", OfflinePolicy.SolutionPath).Set("beforeHashes", Hashes(_before));
            Persist(); // Durable indeterminate-state marker BEFORE invoking a COM write.
        }

        private static Json.JObj Hashes(Dictionary<string, byte[]> files)
        {
            var hashes = new Json.JObj(); foreach (var file in files.OrderBy(x => x.Key, StringComparer.OrdinalIgnoreCase)) hashes[file.Key] = Hash(file.Value); return hashes;
        }

        public void BeforeObjectWrite(string path, bool create, int type = 604)
        {
            Begin();
            string prefix = OfflinePolicy.PlcRoot + "^";
            if (!path.StartsWith(prefix, StringComparison.Ordinal)) throw new BridgeException("Invalid audited object path.");
            string objectPath = path.Substring(prefix.Length);
            string method = null;
            if (type == 609)
            {
                int split = objectPath.LastIndexOf('^');
                method = objectPath.Substring(split + 1); objectPath = objectPath.Substring(0, split);
            }
            string extension = type == 615 ? ".TcGVL" : type == 605 || type == 606 || type == 623 ? ".TcDUT" : ".TcPOU";
            string relative = Path.Combine("MainPLC", objectPath.Replace('^', Path.DirectorySeparatorChar) + extension);
            _expected.Add(relative);
            if (method != null)
            {
                HashSet<string> methods;
                if (!_methods.TryGetValue(relative, out methods)) _methods[relative] = methods = new HashSet<string>(StringComparer.Ordinal);
                methods.Add(method);
                if (create) _newMethods.Add(relative + "^" + method);
            }
            else if (create) _created.Add(relative);
            _report["expectedObjects"] = new Json.JArr(_expected.Cast<object>());
            Persist();
        }

        public void AfterObjectWrite()
        {
            var after = Snapshot(); bool unsafeChange;
            _report["changes"] = Compare(after, out unsafeChange);
            _report["afterHashes"] = Hashes(after);
            if (unsafeChange)
            {
                Block("Unexpected engineering change during PLC object operation; inspect project_save_audit before any further writes.");
                throw new BridgeException(_blocked);
            }
            _checkpoint = after;
            Persist();
        }

        public void Block(string reason)
        {
            _blocked = reason;
            if (_report == null) _report = new Json.JObj();
            _report["state"] = "blocked"; _report["reason"] = reason;
            Persist();
        }

        private void Persist()
        {
            _report["journal"] = _journal;
            WriteDurable(_journal, _report);
        }

        private static void WriteDurable(string path, Json.JObj value, bool createNew = false)
        {
            // A pending journal is persisted before every engineering mutation.
            // Torn records cannot validate; pending dominates any older baseline.
            byte[] bytes = new UTF8Encoding(false).GetBytes(Json.Write(value));
            using (var stream = new FileStream(path, createNew ? FileMode.CreateNew : FileMode.Create, FileAccess.Write, FileShare.None))
            { stream.Write(bytes, 0, bytes.Length); stream.Flush(true); }
        }

        public Json.JObj Changes()
        {
            var result = new Json.JObj().Set("gitStatus", Git("status", "--porcelain=v1", "--untracked-files=all"))
                .Set("gitDiff", Git("diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--", "."))
                .Set("hashes", Hashes(Snapshot())).Set("blocked", _blocked != null).Set("reason", _blocked);
            return result;
        }

        public Json.JObj Preview()
        {
            AssertUnchanged();
            return Changes().Set("expectedObjects", new Json.JArr(_expected.Cast<object>()))
                .Set("hasEditBatch", _before != null).Set("warning", "File.SaveAll may change project metadata. Preview cannot predict COM save effects or guarantee transactional rollback.");
        }

        public Json.JObj Report()
        {
            if (_report != null)
            {
                var result = new Json.JObj(); foreach (var field in _report) result[field.Key] = field.Value;
                return result.Set("blocked", _blocked != null).Set("reason", _blocked).Set("recovered", Recovered);
            }
            if (File.Exists(_journal)) return new Json.JObj().Set("blocked", true).Set("journal", _journal).Set("reportText", File.ReadAllText(_journal));
            return new Json.JObj().Set("state", "no_save_in_this_session").Set("blocked", _blocked != null).Set("reason", _blocked);
        }

        private static XDocument Xml(byte[] bytes)
        {
            using (var stream = new MemoryStream(bytes))
            using (var reader = System.Xml.XmlReader.Create(stream, new System.Xml.XmlReaderSettings { DtdProcessing = System.Xml.DtdProcessing.Prohibit, XmlResolver = null, IgnoreWhitespace = true }))
                return XDocument.Load(reader);
        }

        private static void RemoveTmcHash(XDocument xml)
        {
            foreach (var attr in xml.Descendants().Attributes().Where(a => a.Name.LocalName == "TmcHash").ToList()) attr.Remove();
        }

        private static void Fields(XElement node, string path, Dictionary<string, string> fields)
        {
            foreach (var attr in node.Attributes()) fields[path + "/@" + attr.Name] = attr.Value;
            if (!node.HasElements) fields[path] = node.Value;
            int index = 0;
            foreach (var child in node.Elements()) Fields(child, path + "/" + child.Name + "[" + (++index) + "]", fields);
        }

        private static Json.JArr MetadataChanges(byte[] before, byte[] after)
        {
            var a = new Dictionary<string, string>(); var b = new Dictionary<string, string>();
            if (before != null) Fields(Xml(before).Root, "", a);
            if (after != null) Fields(Xml(after).Root, "", b);
            var changes = new Json.JArr();
            foreach (string key in a.Keys.Union(b.Keys).OrderBy(x => x))
            {
                string oldValue, newValue; a.TryGetValue(key, out oldValue); b.TryGetValue(key, out newValue);
                if (oldValue != newValue) changes.Add(new Json.JObj().Set("field", key).Set("before", oldValue).Set("after", newValue));
            }
            return changes;
        }

        private string Classify(string file, byte[] before, byte[] after)
        {
            if (after == null) return "unexpected_deletion";
            string ext = Path.GetExtension(file).ToLowerInvariant();
            if (ext == ".tsproj" && before != null)
            {
                var a = Xml(before); var b = Xml(after); RemoveTmcHash(a); RemoveTmcHash(b);
                return XNode.DeepEquals(a, b) ? "build_metadata_tmc_hash_or_formatting" : "critical_project_metadata";
            }
            if (ext == ".plcproj" && before != null)
            {
                var a = Xml(before); var b = Xml(after);
                foreach (string created in _created)
                {
                    string include = created.Substring("MainPLC\\".Length);
                    var matches = b.Descendants().Where(e => e.Name.LocalName == "Compile" && string.Equals((string)e.Attribute("Include"), include, StringComparison.OrdinalIgnoreCase)).ToList();
                    if (matches.Count != 1) return "unexpected_project_references";
                    matches[0].Remove();
                }
                return XNode.DeepEquals(a, b) ? "expected_project_references_or_formatting" : "critical_plc_project_metadata";
            }
            if ((ext == ".tcpou" || ext == ".tcdut" || ext == ".tcgvl") && _expected.Contains(file))
            {
                if (before == null)
                {
                    if (!_created.Contains(file)) return "unexpected_new_pou";
                    string element = ext == ".tcgvl" ? "GVL" : ext == ".tcdut" ? "DUT" : "POU";
                    var pous = Xml(after).Descendants().Where(e => e.Name.LocalName == element).ToList();
                    Guid id;
                    if (pous.Count != 1 || (string)pous[0].Attribute("Name") != Path.GetFileNameWithoutExtension(file) || !Guid.TryParse((string)pous[0].Attribute("Id"), out id)) return "critical_new_pou_identity";
                    string previous;
                    if (_newIds.TryGetValue(file, out previous) && previous != id.ToString()) return "critical_new_pou_identity";
                    _newIds[file] = id.ToString();
                    return ext == ".tcgvl" ? "expected_new_gvl" : ext == ".tcdut" ? "expected_new_dut" : "expected_new_pou";
                }
                var a = Xml(before); var b = Xml(after);
                HashSet<string> methods;
                if (_methods.TryGetValue(file, out methods))
                {
                    foreach (string name in methods)
                    {
                        var oldMethods = a.Descendants().Where(e => e.Name.LocalName == "Method" && (string)e.Attribute("Name") == name).ToList();
                        var newMethods = b.Descendants().Where(e => e.Name.LocalName == "Method" && (string)e.Attribute("Name") == name).ToList();
                        if (newMethods.Count != 1) return "critical_method_identity";
                        if (_newMethods.Contains(file + "^" + name))
                        {
                            Guid id; string previous; string key = file + "^" + name;
                            if (oldMethods.Count != 0 || !Guid.TryParse((string)newMethods[0].Attribute("Id"), out id)) return "critical_method_identity";
                            if (_newIds.TryGetValue(key, out previous) && previous != id.ToString()) return "critical_method_identity";
                            _newIds[key] = id.ToString(); newMethods[0].Remove();
                        }
                        else
                        {
                            if (oldMethods.Count != 1) return "critical_method_identity";
                            foreach (var node in oldMethods[0].Elements().Where(e => e.Name.LocalName == "Declaration" || e.Name.LocalName == "Implementation").ToList()) node.Remove();
                            foreach (var node in newMethods[0].Elements().Where(e => e.Name.LocalName == "Declaration" || e.Name.LocalName == "Implementation").ToList()) node.Remove();
                        }
                    }
                    return XNode.DeepEquals(a, b) ? "expected_method_code_or_creation" : "critical_pou_identity_or_structure";
                }
                // Names, IDs, child objects and all other metadata must remain identical.
                foreach (var node in a.Descendants().Where(e => e.Name.LocalName == "POU" || e.Name.LocalName == "DUT" || e.Name.LocalName == "GVL").Elements().Where(e => e.Name.LocalName == "Declaration" || e.Name.LocalName == "Implementation").ToList()) node.Remove();
                foreach (var node in b.Descendants().Where(e => e.Name.LocalName == "POU" || e.Name.LocalName == "DUT" || e.Name.LocalName == "GVL").Elements().Where(e => e.Name.LocalName == "Declaration" || e.Name.LocalName == "Implementation").ToList()) node.Remove();
                return XNode.DeepEquals(a, b) ? "expected_pou_code" : "critical_pou_identity_or_structure";
            }
            return "unexpected_engineering_file";
        }

        private Json.JArr Compare(Dictionary<string, byte[]> after, out bool unsafeChange)
        {
            var changes = new Json.JArr(); unsafeChange = false;
            foreach (string file in _before.Keys.Union(after.Keys, StringComparer.OrdinalIgnoreCase).OrderBy(x => x))
            {
                byte[] oldBytes, newBytes; _before.TryGetValue(file, out oldBytes); after.TryGetValue(file, out newBytes);
                if (oldBytes != null && newBytes != null && Hash(oldBytes) == Hash(newBytes)) continue;
                string category = Classify(file, oldBytes, newBytes);
                if (!category.StartsWith("expected_", StringComparison.Ordinal) && !category.StartsWith("build_metadata_", StringComparison.Ordinal)) unsafeChange = true;
                var change = new Json.JObj().Set("file", file).Set("category", category)
                    .Set("beforeHash", oldBytes == null ? null : Hash(oldBytes)).Set("afterHash", newBytes == null ? null : Hash(newBytes))
                    .Set("beforeText", oldBytes == null ? null : Encoding.UTF8.GetString(oldBytes))
                    .Set("afterText", newBytes == null ? null : Encoding.UTF8.GetString(newBytes));
                if (Path.GetExtension(file).Equals(".tsproj", StringComparison.OrdinalIgnoreCase) || Path.GetExtension(file).Equals(".plcproj", StringComparison.OrdinalIgnoreCase))
                    change["metadataChanges"] = MetadataChanges(oldBytes, newBytes);
                changes.Add(change);
            }
            return changes;
        }

        public Json.JObj Save(Action save)
        {
            return Execute(save, "File.SaveAll");
        }

        public Json.JObj Build(Action build)
        {
            AssertUnblocked();
            if (_before != null) throw new BridgeException("Save and audit pending edits before offline build.");
            return Execute(build, "offline_build");
        }

        private Json.JObj Execute(Action operation, string operationName)
        {
            Begin();
            AssertUnchanged();
            _report["state"] = "executing"; _report["operation"] = operationName; Persist();
            try
            {
                operation(); // Fixed save/build callbacks only; never caller-provided commands.
                var after = Snapshot();
                bool unsafeChange;
                var changes = Compare(after, out unsafeChange);
                _report["changes"] = changes; _report["afterHashes"] = Hashes(after);
                _report["gitDiffAfter"] = Git("diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--", ".");
                _report["saved"] = operationName == "File.SaveAll"; _report["safe"] = !unsafeChange;
                _report["state"] = unsafeChange ? "blocked" : "completed_and_audited";
                Persist();
                string archive = Path.Combine(Path.GetDirectoryName(_journal), DateTime.UtcNow.ToString("yyyyMMddTHHmmssfff") + "-" + Guid.NewGuid().ToString("N") + ".json");
                WriteDurable(archive, _report, true); _report["archive"] = archive;
                if (unsafeChange)
                {
                    _blocked = "Unexpected engineering metadata changed during " + operationName + ". Do not commit, publish, reload or continue writes. Inspect project_save_audit: " + _journal;
                    throw new BridgeException(_blocked);
                }
                if (operationName == "File.SaveAll")
                    WriteDurable(_baseline, new Json.JObj().Set("solution", Path.GetFullPath(OfflinePolicy.SolutionPath))
                        .Set("policyHash", LifecycleIdentity.PolicyHash).Set("gitHead", Git("rev-parse", "HEAD"))
                        .Set("gitStatus", Git("status", "--porcelain=v1", "--untracked-files=all"))
                        .Set("gitDiffHash", Hash(Encoding.UTF8.GetBytes(Git("diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--", "."))))
                        .Set("archive", archive).Set("archiveHash", Hash(File.ReadAllBytes(archive))));
                else if (File.Exists(_baseline))
                    File.Move(_baseline, _baseline + ".pre-build-" + Guid.NewGuid().ToString("N"));
                File.Delete(_journal); // Only the successful audited protocol retires pending.
                _last = after; _before = null; _checkpoint = null; _expected.Clear(); _created.Clear(); _newIds.Clear(); _methods.Clear(); _newMethods.Clear();
                return _report;
            }
            catch (Exception ex)
            {
                if (_blocked == null) Block("Save outcome requires inspection: " + ex.Message);
                throw;
            }
        }
    }
}
