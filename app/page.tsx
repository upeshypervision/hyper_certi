'use client';

import { useState } from 'react';
import Image from 'next/image';
import { generateAndDownloadCertificate } from '@/lib/generateCertificate';

type Status = 'idle' | 'loading' | 'success' | 'error';

const MAIN_SITE = 'https://recruitment.upeshypervision.in';

export default function HomePage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sapid, setSapid] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [verifiedName, setVerifiedName] = useState('');
  const [templateUrl, setTemplateUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const year = new Date().getFullYear();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setMessage('');

    // Client-side validation
    if (!name.trim() || !email.trim() || !sapid.trim()) {
      setStatus('error');
      setMessage('Please fill in all fields.');
      return;
    }

    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), sapid: sapid.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus('error');
        setMessage(data.error ?? 'Verification failed. Please check your details.');
        return;
      }

      setVerifiedName(data.name);
      if (data.templateUrl) {
        setTemplateUrl(data.templateUrl);
      }
      setStatus('success');
    } catch {
      setStatus('error');
      setMessage('Network error. Please check your connection and try again.');
    }
  };

  const handleDownload = async () => {
    setIsGenerating(true);
    try {
      let activeUrl = templateUrl;
      if (!activeUrl) {
        const res = await fetch('/api/template');
        const d = await res.json();
        activeUrl = d.templateUrl;
      }

      if (!activeUrl) {
        throw new Error('Certificate template not found in Supabase. Please contact the administrator.');
      }

      await generateAndDownloadCertificate({
        name: verifiedName,
        templateUrl: activeUrl,
      });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to generate certificate.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    setStatus('idle');
    setMessage('');
    setVerifiedName('');
    setTemplateUrl('');
    setName('');
    setEmail('');
    setSapid('');
  };

  const alertIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );

  return (
    <div className="hv-page">
      {/* Masthead — logo + HYPERVISION wordmark + workshop title */}
      <header className="hv-masthead">
        <div className="hv-brand-row">
          <a
            className="hv-logo-btn"
            href={MAIN_SITE}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Visit the UPES Hypervision main site"
          >
            <Image src="/logo.png" alt="Hypervision" width={62} height={62} priority />
          </a>
          <h1 className="hv-brand-name">HYPERVISION</h1>
        </div>
        <p className="hv-brand-title">Launchpad Workshop</p>
      </header>

      {/* Certificate card */}
      <div className="hv-card">
        {status !== 'success' ? (
          <form onSubmit={handleSubmit} noValidate>
            <div className="hv-card-head">
              <h2>Download your certificate</h2>
              <p>Enter the details you used at registration to verify your participation.</p>
            </div>

            {message && (
              <div className="hv-form-alert" role="alert">
                {alertIcon}
                <span>{message}</span>
              </div>
            )}

            {/* Full Name */}
            <div className="hv-field">
              <label className="hv-label" htmlFor="fullName">
                Full Name<span className="hv-req">*</span>
              </label>
              <input
                id="fullName"
                name="fullName"
                type="text"
                className="hv-input"
                placeholder="e.g. Aarav Sharma"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={status === 'loading'}
                required
              />
            </div>

            {/* SAP ID */}
            <div className="hv-field">
              <label className="hv-label" htmlFor="sapId">
                SAP ID<span className="hv-req">*</span>
              </label>
              <input
                id="sapId"
                name="sapId"
                type="text"
                className="hv-input"
                placeholder="5900XXXXX"
                inputMode="numeric"
                autoComplete="off"
                value={sapid}
                onChange={(e) => setSapid(e.target.value)}
                disabled={status === 'loading'}
                required
              />
              <span className="hv-hint">Your university SAP ID.</span>
            </div>

            {/* Registered Email */}
            <div className="hv-field">
              <label className="hv-label" htmlFor="email">
                Registered Email<span className="hv-req">*</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="hv-input"
                placeholder="name.xxxxx@stu.upes.ac.in"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === 'loading'}
                required
              />
              <span className="hv-hint">Use the email you registered with.</span>
            </div>

            <button id="btn-verify" type="submit" className="hv-submit" disabled={status === 'loading'}>
              {status === 'loading' ? (
                <>
                  <span className="hv-spinner" aria-hidden="true" />
                  Verifying…
                </>
              ) : (
                'Verify & Download Certificate'
              )}
            </button>
          </form>
        ) : (
          /* Success state */
          <div className="hv-success">
            <div className="hv-badge" aria-hidden="true">
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>

            <span className="hv-verified-pill">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              Verified · {verifiedName}
            </span>

            <h2>Your certificate is ready! 🎉</h2>
            <p>
              Your participation in the Hypervision Launchpad Workshop has been verified. Download your
              Certificate of Participation below.
            </p>

            <button type="button" className="hv-submit" onClick={handleDownload} disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <span className="hv-spinner" aria-hidden="true" />
                  Generating PDF…
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Download Certificate (PDF)
                </>
              )}
            </button>

            {message && (
              <div className="hv-form-alert" role="alert">
                {alertIcon}
                <span>{message}</span>
              </div>
            )}

            <button type="button" className="hv-ghost-btn" onClick={handleReset}>
              Verify another certificate
            </button>
          </div>
        )}
      </div>

      <p className="hv-footer">
        © {year} Hypervision · UPES ·{' '}
        <a href={MAIN_SITE} target="_blank" rel="noopener noreferrer">
          Main site
        </a>
      </p>
    </div>
  );
}
