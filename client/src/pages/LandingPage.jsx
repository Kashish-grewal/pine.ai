import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { authStore } from '../store/authStore';

// ================================================================
// LANDING PAGE — Premium marketing page for Pine.AI
// ================================================================

// ── Inline SVG Icons (clean, minimal, Anthropic/OpenAI style) ──
const Icons = {
  mic: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>
    </svg>
  ),
  brain: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a5 5 0 0 1 5 5c0 1.5-.5 2.5-1.5 3.5L12 14l-3.5-3.5C7.5 9.5 7 8.5 7 7a5 5 0 0 1 5-5Z"/>
      <path d="M12 14v8"/><path d="M8 18h8"/><circle cx="8" cy="6" r="1"/><circle cx="16" cy="6" r="1"/>
    </svg>
  ),
  target: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  ),
  workflow: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/>
      <rect x="9" y="15" width="6" height="6" rx="1"/><path d="M6 9v3a1 1 0 0 0 1 1h3"/>
      <path d="M18 9v3a1 1 0 0 1-1 1h-3"/><line x1="12" y1="12" x2="12" y2="15"/>
    </svg>
  ),
  mail: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
    </svg>
  ),
  shield: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>
    </svg>
  ),
  arrow: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
    </svg>
  ),
  chevron: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6"/>
    </svg>
  ),
  sparkle: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/>
    </svg>
  ),
  pine: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L7 9h10L12 2Z"/><path d="M12 7L5 16h14L12 7Z"/><path d="M12 13L4 22h16L12 13Z"/><line x1="12" y1="22" x2="12" y2="24"/>
    </svg>
  ),
};

const LogoMark = ({ size = 'default' }) => (
  <span className={`landing-logomark ${size === 'small' ? 'landing-logomark-sm' : ''}`}>
    <span className="landing-logomark-icon">{Icons.pine}</span>
    <span className="landing-logomark-text">pine<span className="landing-logomark-dot">.ai</span></span>
  </span>
);

export default function LandingPage() {
  const navigate = useNavigate();
  const heroGlowRef = useRef(null);

  useEffect(() => {
    if (authStore.isLoggedIn()) {
      navigate('/dashboard', { replace: true });
    }
  }, [navigate]);

  // Subtle parallax on the hero glow orb
  useEffect(() => {
    const handler = (e) => {
      if (!heroGlowRef.current) return;
      const x = (e.clientX / window.innerWidth - 0.5) * 30;
      const y = (e.clientY / window.innerHeight - 0.5) * 30;
      heroGlowRef.current.style.transform = `translate(${x}px, ${y}px)`;
    };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  const features = [
    { icon: Icons.mic, title: 'Auto-Capture', desc: 'Chrome extension silently records Google Meet — tab audio and your microphone, mixed in real-time.' },
    { icon: Icons.brain, title: 'AI Transcription', desc: 'Whisper-powered transcription with speaker diarization. Know exactly who said what.' },
    { icon: Icons.target, title: 'Task Extraction', desc: 'Groq LLMs extract action items, deadlines, and assign owners automatically from conversation.' },
    { icon: Icons.workflow, title: 'Workflow Diagrams', desc: 'Auto-generated Mermaid.js flowcharts visualize your meeting decisions at a glance.' },
    { icon: Icons.mail, title: 'Email Distribution', desc: 'One-click email summaries with calendar invites sent to every participant instantly.' },
    { icon: Icons.shield, title: 'Secure & Private', desc: 'Self-hosted on your infrastructure. JWT authentication, encrypted connections, zero third-party tracking.' },
  ];

  const steps = [
    { num: '01', title: 'Install Extension', desc: 'Load the Chrome extension and paste your auth token from the dashboard.' },
    { num: '02', title: 'Join a Meeting', desc: 'Start any Google Meet call — recording begins automatically in the background.' },
    { num: '03', title: 'Get Insights', desc: 'AI generates transcript, tasks, key decisions, and workflow diagrams in seconds.' },
    { num: '04', title: 'Share & Act', desc: 'Email summaries to participants and track action items from your dashboard.' },
  ];

  return (
    <div className="landing">
      {/* ── Nav ─────────────────────────────────────── */}
      <nav className="landing-nav">
        <LogoMark />
        <div className="landing-nav-links">
          <a href="#features">Features</a>
          <a href="#how-it-works">How It Works</a>
          <button className="landing-cta-sm" onClick={() => navigate('/auth')}>
            Get Started {Icons.arrow}
          </button>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────── */}
      <section className="landing-hero">
        <div className="landing-hero-glow" ref={heroGlowRef} />
        <div className="landing-hero-content">
          <div className="landing-badge">{Icons.sparkle} AI-Powered Meeting Intelligence</div>
          <h1 className="landing-h1">
            Your meetings.<br />
            <span className="landing-gradient-text">Structured. Actionable. Done.</span>
          </h1>
          <p className="landing-subtitle">
            Pine.AI automatically records, transcribes, and extracts tasks from your 
            Google Meet sessions. Get AI-generated summaries, workflow diagrams, and 
            email reports — without lifting a finger.
          </p>
          <div className="landing-hero-actions">
            <button className="landing-cta" onClick={() => navigate('/auth')}>
              Start Free {Icons.arrow}
            </button>
            <a href="#features" className="landing-cta-ghost">
              See Features {Icons.chevron}
            </a>
          </div>
          <p className="landing-hero-note">No credit card · Self-hosted · Open source</p>
        </div>

        {/* Floating stats */}
        <div className="landing-stats">
          {[
            { num: '10x', label: 'Faster than notes' },
            { num: '100%', label: 'Privacy-first' },
            { num: '0', label: 'Manual effort' },
          ].map((s, i) => (
            <div className="landing-stat" key={i}>
              <span className="landing-stat-num">{s.num}</span>
              <span className="landing-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ────────────────────────────────── */}
      <section className="landing-section" id="features">
        <div className="landing-section-header">
          <span className="landing-section-tag">Features</span>
          <h2 className="landing-h2">Everything you need,<br />nothing you don't.</h2>
          <p className="landing-section-desc">
            From automatic recording to AI-powered task extraction — Pine.AI handles the entire meeting workflow.
          </p>
        </div>
        <div className="landing-features-grid">
          {features.map((f, i) => (
            <div className="landing-feature-card" key={i}>
              <div className="landing-feature-icon">{f.icon}</div>
              <h3 className="landing-feature-title">{f.title}</h3>
              <p className="landing-feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How It Works ────────────────────────────── */}
      <section className="landing-section" id="how-it-works">
        <div className="landing-section-header">
          <span className="landing-section-tag">How It Works</span>
          <h2 className="landing-h2">Four steps. Zero friction.</h2>
        </div>
        <div className="landing-steps">
          {steps.map((s, i) => (
            <div className="landing-step" key={i}>
              <div className="landing-step-num">{s.num}</div>
              <div className="landing-step-content">
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Tech Stack ──────────────────────────────── */}
      <section className="landing-section">
        <div className="landing-section-header">
          <span className="landing-section-tag">Built With</span>
          <h2 className="landing-h2">Modern, production-grade stack.</h2>
        </div>
        <div className="landing-tech-grid">
          {['React', 'Node.js', 'PostgreSQL', 'Whisper AI', 'Groq LLMs', 'Chrome MV3', 'Mermaid.js', 'Nodemailer'].map((t, i) => (
            <div className="landing-tech-chip" key={i}>{t}</div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────── */}
      <section className="landing-final-cta">
        <h2 className="landing-h2">Ready to transform your meetings?</h2>
        <p className="landing-subtitle" style={{ maxWidth: 480 }}>
          Stop wasting time on manual notes. Let Pine.AI handle the grunt work so you can focus on what matters.
        </p>
        <button className="landing-cta" onClick={() => navigate('/auth')}>
          Get Started Free {Icons.arrow}
        </button>
      </section>

      {/* ── Footer ──────────────────────────────────── */}
      <footer className="landing-footer">
        <div className="landing-footer-top">
          <div className="landing-footer-brand">
            <LogoMark size="small" />
            <p className="landing-footer-tagline">AI-powered meeting intelligence.<br />Record, transcribe, extract, distribute.</p>
          </div>
          <div className="landing-footer-columns">
            <div className="landing-footer-col">
              <h4>Product</h4>
              <a href="#features">Features</a>
              <a href="#how-it-works">How It Works</a>
              <a href="https://github.com/Kashish-grewal/pine.ai" target="_blank" rel="noreferrer">GitHub</a>
            </div>
            <div className="landing-footer-col">
              <h4>Resources</h4>
              <a href="#how-it-works">Documentation</a>
              <a href="#features">Chrome Extension</a>
              <a href="#features">API Reference</a>
            </div>
            <div className="landing-footer-col">
              <h4>Legal</h4>
              <a href="#">Privacy Policy</a>
              <a href="#">Terms of Service</a>
            </div>
          </div>
        </div>
        <div className="landing-footer-bottom">
          <p>&copy; {new Date().getFullYear()} Pine.AI — Designed & built by Kashish Grewal</p>
        </div>
      </footer>
    </div>
  );
}
