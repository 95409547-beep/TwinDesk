// TwinDesk microphone fork. GPL-3.0, see LICENSE.
using System;
using System.IO;
using Microsoft.Win32;

namespace MacShare
{
    static class DoubaoInputMethod
    {
        const string Uninstall = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";

        internal static bool IsInstalled()
        {
            foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
            foreach (var view in new[] { RegistryView.Registry32, RegistryView.Registry64 })
            {
                using (var root = RegistryKey.OpenBaseKey(hive, view))
                using (var entries = root.OpenSubKey(Uninstall))
                {
                    if (entries == null) continue;
                    foreach (var name in entries.GetSubKeyNames())
                    using (var entry = entries.OpenSubKey(name))
                    {
                        if (entry == null) continue;
                        var displayName = (entry.GetValue("DisplayName") as string ?? "").Trim();
                        if (displayName == "豆包输入法" ||
                            string.Equals(displayName, "Doubao Input Method", StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(displayName, "DoubaoIME", StringComparison.OrdinalIgnoreCase))
                            return true;
                    }
                }
            }
            // Also recognize a default install when its uninstall entry is absent.
            foreach (var folder in new[] { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86 })
            {
                var programFiles = Environment.GetFolderPath(folder);
                if (programFiles.Length == 0) continue;
                var install = Path.Combine(programFiles, "DoubaoIME");
                if (HasServiceFiles(install)) return true;
                if (Directory.Exists(install))
                    foreach (var directory in Directory.EnumerateDirectories(install))
                        if (HasServiceFiles(directory)) return true;
            }
            return false;
        }

        static bool HasServiceFiles(string directory)
        {
            return File.Exists(Path.Combine(directory, "ImeService.exe")) &&
                   File.Exists(Path.Combine(directory, "rpc.dll"));
        }
    }
}
