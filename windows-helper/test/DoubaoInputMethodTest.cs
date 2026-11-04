// TwinDesk microphone fork. GPL-3.0, see LICENSE.
using System;
using Microsoft.Win32;

namespace MacShare
{
    static class DoubaoInputMethodTest
    {
        static int Main()
        {
            const string uninstall = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\";
            var path = uninstall + "TwinDeskTest-" + Guid.NewGuid();
            try
            {
                if (DoubaoInputMethod.IsInstalled()) throw new Exception("Requires a clean Windows runner.");
                using (var key = Registry.CurrentUser.CreateSubKey(path))
                {
                    key.SetValue("DisplayName", "豆包");
                    if (DoubaoInputMethod.IsInstalled()) throw new Exception("The standalone Doubao app is not an input method.");
                    key.SetValue("DisplayName", "豆包输入法");
                    if (!DoubaoInputMethod.IsInstalled()) throw new Exception("The Doubao Input Method entry was not detected.");
                }
            }
            finally
            {
                Registry.CurrentUser.DeleteSubKeyTree(path, false);
            }
            if (DoubaoInputMethod.IsInstalled()) throw new Exception("Removal of the install entry was not detected.");
            Console.WriteLine("Doubao install detection: missing, unrelated app, installed and removed passed");
            return 0;
        }
    }
}
