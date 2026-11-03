// TwinDesk microphone fork. GPL-3.0, see LICENSE.
using System;
using MacShare;
class MicrophoneKeyTest
{
    static void Equal(int actual, int expected, string why) { if (actual != expected) throw new Exception(why); }
    static void Main()
    {
        var key = new MicrophoneKey(false);
        Equal(key.Intercept(true, true, true, true, false), 2, "fresh physical down");
        Equal(key.Intercept(true, true, true, true, false), 1, "repeat consumed once");
        Equal(key.Intercept(false, false, true, false, false), 0, "injected up cannot release physical hold");
        Equal(key.Intercept(false, true, false, false, false), 3, "up after returning home and disabling still ends round");
        Equal(key.Intercept(true, true, true, true, true), 0, "modified F8 belongs to application");
        Equal(key.Intercept(false, true, true, true, false), 0, "its up belongs to application");
        Equal(key.Intercept(true, true, true, false, false), 0, "press at home");
        Equal(key.Intercept(true, true, true, true, false), 0, "crossing while held cannot start");
        Equal(key.Intercept(false, true, true, true, false), 0, "release home press");
        Equal(key.Intercept(true, false, true, true, false), 0, "injected down cannot capture");
        Equal(key.Intercept(true, true, true, true, false), 2, "fresh press still works");
        var restart = new MicrophoneKey(true);
        Equal(restart.Intercept(true, true, true, true, false), 0, "held key during helper restart cannot replay");
        Equal(restart.Intercept(false, true, true, true, false), 0, "release after helper restart");
        Equal(restart.Intercept(true, true, true, true, false), 2, "next fresh press");
        Console.WriteLine("MicrophoneKey: physical edges, repeats, home crossing, modifiers, injected events and helper restart passed");
    }
}
