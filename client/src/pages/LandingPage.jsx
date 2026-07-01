import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { authStore } from '../store/authStore';
import { Icons } from '../components/Icons';
import dramaticLandscape from '../assets/dramatic_landscape.png';

// ================================================================
// LANDING PAGE — Apogee-Inspired Premium Landing Page for Pine.AI
// With scroll-reveal, animated counters, particles, testimonials
// ================================================================

// ── useScrollReveal — IntersectionObserver hook ─────────────────
function useScrollReveal(threshold = 0.15) {
  const observerRef = useRef(null);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observerRef.current?.unobserve(entry.target);
          }
        });
      },
      { threshold, rootMargin: '0px 0px -60px 0px' }
    );

    const elements = document.querySelectorAll('.reveal');
    elements.forEach((el) => observerRef.current?.observe(el));

    return () => observerRef.current?.disconnect();
  }, [threshold]);
}

// ── useAnimatedCounter — count up from 0 when visible ───────────
function useAnimatedCounter(endValue, suffix = '', duration = 1400) {
  const [display, setDisplay] = useState(`0${suffix}`);
  const ref = useRef(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          const numericEnd = parseFloat(endValue) || 0;
          const start = performance.now();

          const animate = (now) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(numericEnd * eased);
            setDisplay(`${current}${suffix}`);
            if (progress < 1) requestAnimationFrame(animate);
          };

          requestAnimationFrame(animate);
          observer.unobserve(el);
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [endValue, suffix, duration]);

  return { ref, display };
}

const LogoMark = ({ size = 'default' }) => (
  <span className={`landing-logomark ${size === 'small' ? 'landing-logomark-sm' : ''}`}>
    <span className="landing-logomark-icon">{Icons.pine}</span>
    <span className="landing-logomark-text">
      pine<span className="landing-logomark-dot">.ai</span>
    </span>
  </span>
);

// ── Floating particle positions (CSS-only animation) ────────────
const PARTICLES = Array.from({ length: 14 }, (_, i) => ({
  id: i,
  left: `${8 + Math.random() * 84}%`,
  top: `${15 + Math.random() * 70}%`,
  dur: `${6 + Math.random() * 8}s`,
  delay: `${Math.random() * 6}s`,
  size: `${2 + Math.random() * 2}px`,
}));

// ── Testimonials data ───────────────────────────────────────────
const TESTIMONIALS = [
  {
    quote: "Pine.AI replaced our entire manual note-taking workflow. The AI task extraction alone saves our team 4 hours every sprint cycle.",
    name: "Aditya Verma",
    role: "Engineering Manager, CloudScale",
    initials: "AV",
  },
  {
    quote: "The real-time transcription accuracy is remarkable. Speaker diarization correctly identifies all 6 participants in our standups, every single time.",
    name: "Priya Sharma",
    role: "Product Lead, DataWorks",
    initials: "PS",
  },
  {
    quote: "Self-hosted, privacy-first, and it actually works. We deployed Pine.AI in a weekend and haven't looked back. Our meeting intelligence is completely automated.",
    name: "Marcus Chen",
    role: "CTO, NexaLabs",
    initials: "MC",
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('efficiency');
  const [hoveredChartPoint, setHoveredChartPoint] = useState(null);
  const [hoveredClusterNode, setHoveredClusterNode] = useState(null);
  const [tasks, setTasks] = useState([
    { id: 1, title: 'Migrate Pine Extension to Manifest V3', priority: 'high', owner: 'AG', done: true },
    { id: 2, title: 'Integrate Whisper diarization model for speaker tags', priority: 'medium', owner: 'SG', done: false },
    { id: 3, title: 'Set up automated weekly action-items email updates', priority: 'medium', owner: 'Team', done: false }
  ]);
  const [activeSpeakerIdx, setActiveSpeakerIdx] = useState(0);
  const [navScrolled, setNavScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState('');

  // Redirect if already logged in
  useEffect(() => {
    if (authStore.isLoggedIn()) {
      navigate('/dashboard', { replace: true });
    }
  }, [navigate]);

  // Scroll reveal
  useScrollReveal();

  // Mouse tracking for feature cards border glow
  useEffect(() => {
    const handler = (e) => {
      const cards = document.querySelectorAll('.landing-feature-card');
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        card.style.setProperty('--mouse-x', `${x}px`);
        card.style.setProperty('--mouse-y', `${y}px`);
      }
    };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  // Sticky nav scroll detection + active section tracking
  useEffect(() => {
    const handleScroll = () => {
      setNavScrolled(window.scrollY > 100);

      const sections = ['features', 'testimonials', 'how-it-works'];
      let current = '';
      for (const id of sections) {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 200) current = id;
        }
      }
      setActiveSection(current);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Speaker simulation sequence
  useEffect(() => {
    if (activeTab !== 'live') return;
    const interval = setInterval(() => {
      setActiveSpeakerIdx((prev) => (prev + 1) % 3);
    }, 4000);
    return () => clearInterval(interval);
  }, [activeTab]);

  const toggleTask = (id) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  // Animated counters
  const counter1 = useAnimatedCounter(10, 'x');
  const counter2 = useAnimatedCounter(100, '%');
  const counter3 = useAnimatedCounter(0, '');

  const chartPoints = [
    { x: 80, y: 190, month: 'Jan', meetings: 12, hours: 4 },
    { x: 180, y: 150, month: 'Feb', meetings: 38, hours: 14 },
    { x: 280, y: 160, month: 'Mar', meetings: 82, hours: 32 },
    { x: 380, y: 100, month: 'Apr', meetings: 164, hours: 68 },
    { x: 480, y: 50, month: 'May', meetings: 310, hours: 130 }
  ];

  const clusterNodes = [
    { id: 1, label: 'Engineering Sprints', count: 84, color: '#f59e0b', top: '15%', left: '10%' },
    { id: 2, label: 'Product Demos', count: 42, color: '#a855f7', top: '25%', left: '70%' },
    { id: 3, label: 'Client Syncs', count: 115, color: '#10b981', top: '75%', left: '15%' },
    { id: 4, label: 'Strategy & Roadmap', count: 19, color: '#3b82f6', top: '70%', left: '68%' }
  ];

  const features = [
    { icon: Icons.mic, title: 'Auto-Capture', desc: 'Chrome extension silently records Google Meet — tab audio and your microphone, mixed in real-time.' },
    { icon: Icons.brain, title: 'AI Transcription', desc: 'Whisper-powered transcription with speaker diarization. Know exactly who said what.' },
    { icon: Icons.target, title: 'Task Extraction', desc: 'Groq LLMs extract action items, deadlines, and assign owners automatically from conversation.' },
    { icon: Icons.workflow, title: 'Workflow Diagrams', desc: 'Auto-generated Mermaid.js flowcharts visualize your meeting decisions at a glance.' },
    { icon: Icons.mail, title: 'Email Distribution', desc: 'One-click email summaries with calendar invites sent to every participant instantly.' },
    { icon: Icons.shield, title: 'Secure & Private', desc: 'Self-hosted on your infrastructure. JWT authentication, encrypted connections, zero third-party tracking.' }
  ];

  const steps = [
    { num: '01', title: 'Install Extension', desc: 'Load the Chrome extension and paste your auth token from the dashboard.' },
    { num: '02', title: 'Join a Meeting', desc: 'Start any Google Meet call — recording begins automatically in the background.' },
    { num: '03', title: 'Get Insights', desc: 'AI generates transcript, tasks, key decisions, and workflow diagrams in seconds.' },
    { num: '04', title: 'Share & Act', desc: 'Email summaries to participants and track action items from your dashboard.' }
  ];

  return (
    <div className="landing">
      {/* ── Nav ─────────────────────────────────────── */}
      <nav className={`landing-nav${navScrolled ? ' scrolled' : ''}`}>
        <LogoMark />
        <div className="landing-nav-links">
          <a href="#features" className={activeSection === 'features' ? 'nav-active' : ''}>Features</a>
          <a href="#testimonials" className={activeSection === 'testimonials' ? 'nav-active' : ''}>Testimonials</a>
          <a href="#how-it-works" className={activeSection === 'how-it-works' ? 'nav-active' : ''}>How It Works</a>
          <a onClick={() => navigate('/extension')} style={{ cursor: 'pointer' }}>Extension</a>
        </div>
        <button className="landing-cta-sm" onClick={() => navigate('/auth')}>
          Book a demo {Icons.arrow}
        </button>
      </nav>

      {/* ── Hero ────────────────────────────────────── */}
      <section className="landing-hero" style={{ backgroundImage: `linear-gradient(to bottom, rgba(5, 5, 7, 0.45) 0%, rgba(5, 5, 7, 0.95) 75%, #050507 100%), url(${dramaticLandscape})` }}>
        
        {/* Floating particles */}
        <div className="landing-particles">
          {PARTICLES.map((p) => (
            <div
              key={p.id}
              className="landing-particle"
              style={{
                left: p.left,
                top: p.top,
                width: p.size,
                height: p.size,
                '--dur': p.dur,
                '--delay': p.delay,
              }}
            />
          ))}
        </div>

        <div className="landing-hero-content">
          <div className="landing-badge">
            {Icons.sparkle} Visionary Meeting Intelligence
          </div>
          <h1 className="landing-h1">
            Your meetings.<br />
            <span className="landing-gradient-text">Structured. Predictive. Done.</span>
          </h1>
          <p className="landing-subtitle">
            Pine.AI transforms meeting conversations into actionable growth intelligence. 
            Automatic recording, Whisper-driven transcription, and instant AI workflows 
            designed for modern, scaling enterprises.
          </p>
          <div className="landing-hero-actions">
            <button className="landing-cta" onClick={() => navigate('/auth')}>
              Book a demo {Icons.arrow}
            </button>
            <button className="landing-cta-ghost" onClick={() => navigate('/extension')}>
              {Icons.download} Discover the Core
            </button>
          </div>
          <p className="landing-hero-note">No credit card required · Self-hosted · Privacy First</p>
        </div>

        {/* ── Interactive Dashboard Mockup ────────────── */}
        <div className="landing-dashboard-wrapper">
          <div className="landing-dashboard-glow-1" />
          <div className="landing-dashboard-glow-2" />
          
          <div className="landing-dashboard-mockup">
            
            {/* LEFT COLUMN: Main view based on active tab */}
            <div className="mockup-panel">
              <div className="mockup-panel-header">
                <span className="mockup-panel-title">
                  {activeTab === 'efficiency' && 'Predictive Efficiency Trajectory'}
                  {activeTab === 'live' && 'Real-time Capture Feed'}
                  {activeTab === 'tasks' && 'Structured AI Task Extractor'}
                  {activeTab === 'clusters' && 'Global Cluster Insights'}
                </span>
                {activeTab === 'live' && (
                  <div className="mockup-live-indicator">
                    <span className="mockup-live-dot" />
                    Live Capture
                  </div>
                )}
              </div>

              {/* VIEW 1: Efficiency Chart */}
              {activeTab === 'efficiency' && (
                <div className="trajectory-chart-container">
                  <svg className="trajectory-svg" viewBox="0 0 540 220">
                    <defs>
                      <linearGradient id="chart-gradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.4" />
                        <stop offset="50%" stopColor="#a855f7" />
                        <stop offset="100%" stopColor="#6366f1" />
                      </linearGradient>
                    </defs>

                    {/* Grid lines */}
                    {[50, 100, 150, 200].map((y, idx) => (
                      <line key={idx} className="chart-grid-line" x1="50" y1={y} x2="500" y2={y} />
                    ))}

                    {/* Background faint path */}
                    <path className="trajectory-path-bg" d="M 80 190 L 180 150 L 280 160 L 380 100 L 480 50" />

                    {/* Main glowing path */}
                    <path className="trajectory-path" d="M 80 190 C 130 180, 130 140, 180 150 C 230 160, 230 170, 280 160 C 330 150, 330 110, 380 100 C 430 90, 430 60, 480 50" />

                    {/* Axis Labels */}
                    {chartPoints.map((pt, idx) => (
                      <g key={idx}>
                        <text className="chart-axis-text" x={pt.x} y="215" textAnchor="middle">{pt.month}</text>
                        {/* Dot */}
                        <circle 
                          className="chart-glow-dot" 
                          cx={pt.x} 
                          cy={pt.y} 
                          r={idx === hoveredChartPoint ? 7 : 5}
                          onMouseEnter={() => setHoveredChartPoint(idx)}
                          onMouseLeave={() => setHoveredChartPoint(null)}
                          style={{ cursor: 'pointer', transition: 'r 0.2s' }}
                        />
                      </g>
                    ))}
                  </svg>

                  {/* Tooltip */}
                  {hoveredChartPoint !== null && (
                    <div 
                      className="chart-tooltip-wrapper"
                      style={{ 
                        left: `${(chartPoints[hoveredChartPoint].x / 540) * 100}%`, 
                        top: `${(chartPoints[hoveredChartPoint].y / 220) * 100}%` 
                      }}
                    >
                      <div className="chart-tooltip-label">Efficiency gains ({chartPoints[hoveredChartPoint].month})</div>
                      <div className="chart-tooltip-value">
                        {chartPoints[hoveredChartPoint].meetings} meetings · {chartPoints[hoveredChartPoint].hours} hrs saved
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* VIEW 2: Live Meeting */}
              {activeTab === 'live' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div className="mockup-wave-container">
                    {[...Array(24)].map((_, i) => (
                      <div 
                        key={i} 
                        className="mockup-wave-bar" 
                        style={{ animationDelay: `${i * 0.05}s` }}
                      />
                    ))}
                  </div>
                  
                  <div className="mockup-transcript-feed">
                    <div className={`mockup-transcript-bubble ${activeSpeakerIdx === 0 ? 'active' : ''}`}>
                      <div className="mockup-speaker">SARAH GREWAL (PRODUCT) · 10:14 AM</div>
                      <div className="mockup-text">"Let's prioritize migrating the extension to Manifest V3 so it supports Chrome's latest safety standards."</div>
                    </div>
                    <div className={`mockup-transcript-bubble ${activeSpeakerIdx === 1 ? 'active' : ''}`}>
                      <div className="mockup-speaker">ALEX (ENGINEERING) · 10:15 AM</div>
                      <div className="mockup-text">"Agreed. I will take ownership of rewriting the service workers and testing tab audio routing."</div>
                    </div>
                    <div className={`mockup-transcript-bubble ${activeSpeakerIdx === 2 ? 'active' : ''}`}>
                      <div className="mockup-speaker">PINE.AI (INTELLIGENCE) · 10:15 AM</div>
                      <div className="mockup-text" style={{ color: '#fbbf24', fontWeight: 500 }}>
                        ✦ AI EXTRACTED TASK: Migrate Pine Extension to Manifest V3. Assignee: Alex.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* VIEW 3: Tasks List */}
              {activeTab === 'tasks' && (
                <div className="mockup-tasks-list">
                  {tasks.map((task) => (
                    <div key={task.id} className={`mockup-task-item ${task.done ? 'done' : ''}`} onClick={() => toggleTask(task.id)} style={{ cursor: 'pointer' }}>
                      <div className="mockup-task-check">
                        {task.done && '✓'}
                      </div>
                      <div className="mockup-task-content">
                        <div className="mockup-task-title">{task.title}</div>
                      </div>
                      <div className="mockup-task-meta">
                        <span className={`mockup-task-badge ${task.priority}`}>
                          {task.priority}
                        </span>
                        <div className="mockup-task-avatar">{task.owner}</div>
                      </div>
                    </div>
                  ))}
                  <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '8px' }}>
                    * Click rows to simulate checking/completing action items in real-time.
                  </p>
                </div>
              )}

              {/* VIEW 4: Cluster Network Map */}
              {activeTab === 'clusters' && (
                <div className="mockup-insights-container">
                  <svg className="cluster-line-svg">
                    <line className="cluster-connection-line" x1="50%" y1="50%" x2="15%" y2="20%" />
                    <line className="cluster-connection-line" x1="50%" y1="50%" x2="72%" y2="30%" />
                    <line className="cluster-connection-line" x1="50%" y1="50%" x2="20%" y2="80%" />
                    <line className="cluster-connection-line" x1="50%" y1="50%" x2="70%" y2="75%" />
                  </svg>
                  
                  <div className="cluster-center">
                    {Icons.pine}
                  </div>

                  {clusterNodes.map((node) => (
                    <div 
                      key={node.id} 
                      className="cluster-node" 
                      style={{ top: node.top, left: node.left }}
                      onMouseEnter={() => setHoveredClusterNode(node.id)}
                      onMouseLeave={() => setHoveredClusterNode(null)}
                    >
                      <span className="cluster-node-dot" style={{ backgroundColor: node.color }} />
                      <span>{node.label}</span>
                      {hoveredClusterNode === node.id && (
                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginLeft: '4px' }}>
                          ({node.count} items)
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

            </div>

            {/* RIGHT COLUMN: Sidebar controls and overview metrics */}
            <div className="mockup-panel" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="mockup-panel-header" style={{ marginBottom: '16px' }}>
                  <span className="mockup-panel-title">Explore Platform</span>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    { key: 'efficiency', icon: '📈', title: 'Predictive Analytics', sub: 'Track efficiency trajectory' },
                    { key: 'live', icon: '🎙️', title: 'Live Meeting Capture', sub: 'Simulate active recordings' },
                    { key: 'tasks', icon: '✦', title: 'Structured Action Items', sub: 'AI extracted deadlines' },
                    { key: 'clusters', icon: '🕸️', title: 'Global Cluster Insights', sub: 'Semantic network relations' },
                  ].map((tab) => (
                    <button 
                      key={tab.key}
                      className={`mockup-tab-btn ${activeTab === tab.key ? 'active' : ''}`}
                      onClick={() => setActiveTab(tab.key)}
                      style={{ textAlign: 'left', padding: '12px 16px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}
                    >
                      <span style={{ color: activeTab === tab.key ? '#fbbf24' : 'rgba(255,255,255,0.3)' }}>{tab.icon}</span>
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 600 }}>{tab.title}</div>
                        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', fontWeight: 400 }}>{tab.sub}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Bottom statistics indicator */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '16px', marginTop: '16px' }}>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                  Model Performance
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 500, fontFamily: 'var(--font-sans)', color: '#ffffff' }}>99.2%</div>
                    <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Accuracy</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 500, fontFamily: 'var(--font-sans)', color: '#ffffff' }}>&lt; 3.0s</div>
                    <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Diarization</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 500, fontFamily: 'var(--font-sans)', color: '#ffffff' }}>18 hrs</div>
                    <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Weekly Saved</div>
                  </div>
                </div>
              </div>

            </div>

          </div>
        </div>

        {/* Floating stats below the mockup — animated counters */}
        <div className="landing-stats reveal">
          {[
            { ref: counter1.ref, display: counter1.display, label: 'Faster decision cycles' },
            { ref: counter2.ref, display: counter2.display, label: 'Privacy & Self-hosted' },
            { ref: counter3.ref, display: counter3.display, label: 'Manual notes required' }
          ].map((s, i) => (
            <div className="landing-stat" key={i}>
              <span className="landing-stat-num" ref={s.ref}>{s.display}</span>
              <span className="landing-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features Section ─────────────────────────── */}
      <section className="landing-section" id="features">
        <div className="landing-section-header reveal">
          <span className="landing-section-tag">Features</span>
          <h2 className="landing-h2">
            Everything you need for <br />
            <span className="landing-italic">intelligent meeting coordination.</span>
          </h2>
          <p className="landing-section-desc">
            From seamless Chrome tab recording to automated action item extractions, 
            Pine.AI handles your entire workflow.
          </p>
        </div>
        
        <div className="landing-features-grid">
          {features.map((f, i) => (
            <div className={`landing-feature-card reveal reveal-delay-${i + 1}`} key={i}>
              <div className="landing-feature-icon">{f.icon}</div>
              <h3 className="landing-feature-title">{f.title}</h3>
              <p className="landing-feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Testimonials / Social Proof ───────────────── */}
      <section className="landing-section" id="testimonials" style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
        <div className="landing-section-header reveal">
          <span className="landing-section-tag">What Teams Say</span>
          <h2 className="landing-h2">
            Trusted by engineering teams <br />
            <span className="landing-italic">who value their time.</span>
          </h2>
        </div>

        <div className="landing-testimonials-grid">
          {TESTIMONIALS.map((t, i) => (
            <div className={`testimonial-card reveal reveal-delay-${i + 1}`} key={i}>
              <p className="testimonial-quote">{t.quote}</p>
              <div className="testimonial-author">
                <div className="testimonial-avatar">{t.initials}</div>
                <div className="testimonial-author-info">
                  <span className="testimonial-name">{t.name}</span>
                  <span className="testimonial-role">{t.role}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How It Works ────────────────────────────── */}
      <section className="landing-section" id="how-it-works" style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
        <div className="landing-section-header reveal">
          <span className="landing-section-tag">How It Works</span>
          <h2 className="landing-h2">
            Four simple steps. <br />
            <span className="landing-italic">Absolutely zero friction.</span>
          </h2>
        </div>
        
        <div className="landing-steps">
          {steps.map((s, i) => (
            <div className={`landing-step reveal reveal-delay-${i + 1}`} key={i}>
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
      <section className="landing-section" style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
        <div className="landing-section-header reveal">
          <span className="landing-section-tag">Built With</span>
          <h2 className="landing-h2">A production-grade modern stack.</h2>
        </div>
        
        <div className="landing-tech-grid">
          {['React 19', 'Node.js', 'PostgreSQL', 'Whisper AI', 'Groq LLMs', 'Chrome MV3', 'Mermaid.js', 'Nodemailer'].map((t, i) => (
            <div className={`landing-tech-chip reveal reveal-delay-${(i % 4) + 1}`} key={i}>{t}</div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────── */}
      <section className="landing-final-cta reveal" style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
        <h2 className="landing-h2">
          Ready to experience the <br />
          <span className="landing-italic">future of meeting workflows?</span>
        </h2>
        <p className="landing-subtitle" style={{ maxWidth: 500 }}>
          Stop wasting hours on manual tasks. Let Pine.AI transcribe, organize, and follow up automatically.
        </p>
        <button className="landing-cta" onClick={() => navigate('/auth')}>
          Book a demo {Icons.arrow}
        </button>
      </section>

      {/* ── Footer ──────────────────────────────────── */}
      <div className="landing-footer-separator" />
      <footer className="landing-footer">
        <div className="landing-footer-top">
          <div className="landing-footer-brand">
            <LogoMark size="small" />
            <p className="landing-footer-tagline">
              AI-powered meeting intelligence.<br />
              Record, transcribe, extract, distribute.
            </p>
            <div className="landing-footer-social">
              <a href="https://github.com/Kashish-grewal/pine.ai" target="_blank" rel="noreferrer" title="GitHub">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
              </a>
              <a href="https://linkedin.com/in/kashish-grewal" target="_blank" rel="noreferrer" title="LinkedIn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/></svg>
              </a>
              <a href="https://twitter.com" target="_blank" rel="noreferrer" title="Twitter / X">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/></svg>
              </a>
            </div>
          </div>
          
          <div className="landing-footer-columns">
            <div className="landing-footer-col">
              <h4>Product</h4>
              <a href="#features">Features</a>
              <a href="#testimonials">Testimonials</a>
              <a href="#how-it-works">How It Works</a>
              <a href="https://github.com/Kashish-grewal/pine.ai" target="_blank" rel="noreferrer">
                GitHub Repository
              </a>
            </div>
            
            <div className="landing-footer-col">
              <h4>Resources</h4>
              <a href="#how-it-works">Documentation</a>
              <a onClick={() => navigate('/extension')} style={{ cursor: 'pointer' }}>
                Chrome Extension
              </a>
              <a href="#features">API Integration</a>
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
