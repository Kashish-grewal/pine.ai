import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icons } from '../components/Icons';

// ================================================================
// EXTENSION PAGE — Download & install the Pine.AI Chrome Extension
// ================================================================

const API_BASE =
  import.meta.env.VITE_API_FALLBACK_BASE_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  'http://localhost:5001/api/v1';

const LogoMark = ({ size = 'default' }) => (
  <span className={`landing-logomark ${size === 'small' ? 'landing-logomark-sm' : ''}`}>
    <span className="landing-logomark-icon">{Icons.pine}</span>
    <span className="landing-logomark-text">pine<span className="landing-logomark-dot">.ai</span></span>
  </span>
);

export default function ExtensionPage() {
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);
  const [extInfo, setExtInfo] = useState(null);
  const glowRef = useRef(null);

  // Fetch extension metadata
  useEffect(() => {
    fetch(`${API_BASE}/extension/info`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setExtInfo(data.extension);
      })
      .catch(() => { /* silently fail — info is optional */ });
  }, []);

  // Mouse parallax for glow
  useEffect(() => {
    const handler = (e) => {
      if (glowRef.current) {
        const x = (e.clientX / window.innerWidth - 0.5) * 30;
        const y = (e.clientY / window.innerHeight - 0.5) * 30;
        glowRef.current.style.transform = `translate(${x}px, ${y}px)`;
      }
    };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`${API_BASE}/extension/download`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pine-ai-extension.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      alert('Failed to download extension. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const steps = [
    {
      num: '01',
      title: 'Download the Extension',
      desc: 'Click the download button above to get the Pine.AI extension as a .zip file.',
      icon: Icons.download,
    },
    {
      num: '02',
      title: 'Unzip the File',
      desc: 'Extract the downloaded .zip file to a folder on your computer. Remember where you saved it.',
      icon: (
        <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M3 8V4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4"/><path d="M12 2v13"/><path d="m8 10 4 4 4-4"/>
        </svg>
      ),
    },
    {
      num: '03',
      title: 'Open Chrome Extensions',
      desc: (
        <>
          Go to <code className="ext-code">chrome://extensions</code> in your Chrome browser and enable <strong>Developer Mode</strong> (top-right toggle).
        </>
      ),
      icon: Icons.settings,
    },
    {
      num: '04',
      title: 'Load the Extension',
      desc: (
        <>
          Click <strong>"Load unpacked"</strong> and select the unzipped <code className="ext-code">pine-ai-extension</code> folder. That's it!
        </>
      ),
      icon: Icons.check,
    },
  ];

  return (
    <div className="landing">
      {/* ── Nav ─────────────────────────────────────── */}
      <nav className="landing-nav">
        <a onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
          <LogoMark />
        </a>
        <div className="landing-nav-links">
          <a onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>Home</a>
          <a onClick={() => navigate('/#features')} style={{ cursor: 'pointer' }}>Features</a>
          <button className="landing-cta-sm" onClick={() => navigate('/auth')}>
            Get Started {Icons.arrow}
          </button>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────── */}
      <section className="landing-hero ext-hero">
        <div className="landing-hero-glow" ref={glowRef} />
        <div className="landing-hero-content">
          <div className="landing-badge">
            {Icons.download} Free Chrome Extension
          </div>
          <h1 className="landing-h1">
            Get the <br />
            <span className="landing-gradient-text">Pine.AI Extension</span>
          </h1>
          <p className="landing-subtitle">
            Download the Chrome extension to automatically record, transcribe,
            and extract tasks from your Google Meet sessions — completely free.
          </p>

          {/* Download button */}
          <div className="landing-hero-actions">
            <button
              id="download-extension-btn"
              className="landing-cta ext-download-btn"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? (
                <>
                  <span className="ext-spinner" /> Downloading…
                </>
              ) : (
                <>
                  {Icons.download} Download Extension (.zip)
                </>
              )}
            </button>
          </div>
          {extInfo && (
            <p className="landing-hero-note">
              Version {extInfo.version} · Free forever · No account needed to install
            </p>
          )}
          {!extInfo && (
            <p className="landing-hero-note">
              Free forever · No account needed to install · Chrome & Edge compatible
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="landing-stats">
          {[
            { num: 'Free', label: 'No payment ever' },
            { num: 'MV3', label: 'Manifest V3' },
            { num: '< 1min', label: 'Install time' },
          ].map((s, i) => (
            <div className="landing-stat" key={i}>
              <span className="landing-stat-num">{s.num}</span>
              <span className="landing-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Installation Steps ────────────────────────── */}
      <section className="landing-section" id="install-steps">
        <div className="landing-section-header">
          <span className="landing-section-tag">Installation</span>
          <h2 className="landing-h2">Four steps. Under a minute.</h2>
          <p className="landing-section-desc">
            No developer account needed. No store fees. Just download, unzip, and load.
          </p>
        </div>
        <div className="ext-steps-grid">
          {steps.map((s, i) => (
            <div className="ext-step-card" key={i}>
              <div className="ext-step-num">{s.num}</div>
              <div className="ext-step-icon-wrap">{s.icon}</div>
              <h3 className="ext-step-title">{s.title}</h3>
              <p className="ext-step-desc">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Visual Guide ──────────────────────────────── */}
      <section className="landing-section">
        <div className="landing-section-header">
          <span className="landing-section-tag">Quick Guide</span>
          <h2 className="landing-h2">How to enable Developer Mode</h2>
        </div>
        <div className="ext-guide-card">
          <div className="ext-guide-steps">
            <div className="ext-guide-step">
              <div className="ext-guide-step-num">1</div>
              <div className="ext-guide-step-text">
                <h4>Open Extensions Page</h4>
                <p>Type <code className="ext-code">chrome://extensions</code> in Chrome's address bar and press Enter.</p>
              </div>
            </div>
            <div className="ext-guide-step">
              <div className="ext-guide-step-num">2</div>
              <div className="ext-guide-step-text">
                <h4>Enable Developer Mode</h4>
                <p>Click the <strong>"Developer mode"</strong> toggle switch in the top-right corner of the extensions page.</p>
              </div>
            </div>
            <div className="ext-guide-step">
              <div className="ext-guide-step-num">3</div>
              <div className="ext-guide-step-text">
                <h4>Load Unpacked</h4>
                <p>Click <strong>"Load unpacked"</strong> in the top-left, then navigate to and select the unzipped <code className="ext-code">pine-ai-extension</code> folder.</p>
              </div>
            </div>
            <div className="ext-guide-step">
              <div className="ext-guide-step-num">4</div>
              <div className="ext-guide-step-text">
                <h4>You're Ready!</h4>
                <p>The Pine.AI icon will appear in your toolbar. Click it to connect your account and start recording Google Meets.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────── */}
      <section className="landing-section">
        <div className="landing-section-header">
          <span className="landing-section-tag">FAQ</span>
          <h2 className="landing-h2">Common questions</h2>
        </div>
        <div className="ext-faq-grid">
          <div className="ext-faq-item">
            <h4>Is this really free?</h4>
            <p>Yes — 100% free, forever. No hidden charges, no subscriptions, no premium tier.</p>
          </div>
          <div className="ext-faq-item">
            <h4>Does it work on Edge?</h4>
            <p>Yes! Microsoft Edge is Chromium-based, so the extension works the same way — just go to <code className="ext-code">edge://extensions</code> instead.</p>
          </div>
          <div className="ext-faq-item">
            <h4>Why not the Chrome Web Store?</h4>
            <p>We distribute directly so you get instant updates and zero store fees. The extension works identically to a store-installed one.</p>
          </div>
          <div className="ext-faq-item">
            <h4>Is my data safe?</h4>
            <p>Your audio is processed through your own Pine.AI server. Nothing is stored by third parties. Zero tracking, zero ads.</p>
          </div>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────── */}
      <section className="landing-final-cta">
        <h2 className="landing-h2">Ready to supercharge your meetings?</h2>
        <p className="landing-subtitle" style={{ maxWidth: 480 }}>
          Download the extension, create a free account, and let Pine.AI handle your meeting notes.
        </p>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="landing-cta ext-download-btn" onClick={handleDownload} disabled={downloading}>
            {downloading ? 'Downloading…' : <>{Icons.download} Download Extension</>}
          </button>
          <button className="landing-cta-ghost" onClick={() => navigate('/auth')} style={{ cursor: 'pointer' }}>
            Create Free Account {Icons.arrow}
          </button>
        </div>
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
              <a onClick={() => navigate('/#features')} style={{ cursor: 'pointer' }}>Features</a>
              <a onClick={() => navigate('/#how-it-works')} style={{ cursor: 'pointer' }}>How It Works</a>
              <a onClick={() => navigate('/extension')} style={{ cursor: 'pointer' }}>Chrome Extension</a>
            </div>
            <div className="landing-footer-col">
              <h4>Resources</h4>
              <a href="https://github.com/Kashish-grewal/pine.ai" target="_blank" rel="noreferrer">GitHub</a>
              <a onClick={() => navigate('/auth')} style={{ cursor: 'pointer' }}>Get Started</a>
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
