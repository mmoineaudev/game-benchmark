#pragma once
class AudioSystem {
public:
    void init();
    void shutdown();
    void update(float dt, float thrust, bool firing);
    void playLaser();
    void playExplosion();
    void playShield();
    void setMuted(bool m);
private:
    bool m_muted = false;
    void* m_device = nullptr;
};
