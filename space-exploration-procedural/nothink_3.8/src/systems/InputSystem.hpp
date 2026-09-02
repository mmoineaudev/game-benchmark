#pragma once
class InputSystem {
public:
    void init();
    void update();
    void shutdown();

    bool isFiring() const { return m_firing; }
    bool isShieldHeld() const { return m_shield; }
    float throttle() const { return m_throttle; }
    float pitchDelta() const;
    float yawDelta() const;
    float rollDelta() const;
    bool wantPause() const { return m_pause; }
    bool wantMute() const { return m_mute; }
    bool wantRestart() const { return m_restart; }
    bool wantLightProfile() const { return m_lightProfile; }
    bool wantLadderChart() const { return m_ladderChart; }
    void consumePause() { m_pause = false; }
    void consumeMute() { m_mute = false; }
    void consumeRestart() { m_restart = false; }
    void consumeLightProfile() { m_lightProfile = false; }
    void consumeLadderChart() { m_ladderChart = false; }

private:
    bool m_firing = false;
    bool m_shield = false;
    float m_throttle = 0.5f;
    float m_pitchVel = 0, m_yawVel = 0, m_rollVel = 0;
    bool m_pause = false, m_mute = false, m_restart = false;
    bool m_lightProfile = false, m_ladderChart = false;
};
