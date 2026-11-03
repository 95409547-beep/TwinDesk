// TwinDesk microphone fork. GPL-3.0, see LICENSE.
namespace MacShare
{
    // Pure physical-edge gate. A key held at home or before helper startup cannot start a round.
    sealed class MicrophoneKey
    {
        bool physicalDown, active;
        public MicrophoneKey(bool initiallyDown) { physicalDown = initiallyDown; }
        // 0: pass through, 1: consume, 2: fresh DOWN, 3: physical UP (including back at home).
        public int Intercept(bool down, bool physical, bool enabled, bool capturing, bool modifiers)
        {
            if (!physical) return 0;
            bool repeat = down && physicalDown;
            physicalDown = down;
            if (active)
            {
                if (!down) { active = false; return 3; }
                return 1;
            }
            if (enabled && capturing && down && !repeat && !modifiers) { active = true; return 2; }
            return 0;
        }
    }
}
