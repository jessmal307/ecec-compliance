import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ThemeToggle } from './ThemeToggle'
import { paths } from '../lib/paths'
import './Landing.css'

const CONTACT_EMAIL = paths.contactEmail

function LogoMark() {
  return (
    <svg
      viewBox="0 0 32 32"
      className="size-8 shrink-0"
      aria-hidden
    >
      <rect width="32" height="32" rx="8" fill="#14303f" />
      <path
        d="M8 20.5c3.2-6 6.4-9 8-9s4.8 3 8 9"
        fill="none"
        stroke="#12855a"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="16" cy="11.5" r="1.7" fill="#1f6f82" />
    </svg>
  )
}

function CopyEmailButton() {
  const [copied, setCopied] = useState(false)

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <a
        href={`mailto:${CONTACT_EMAIL}`}
        className="landing-brand select-all text-lg underline underline-offset-4"
      >
        {CONTACT_EMAIL}
      </a>
      <button
        type="button"
        className="landing-btn min-h-11 border border-[var(--landing-line)] bg-[var(--landing-paper)] text-[var(--landing-navy)]"
        onClick={copyEmail}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}

export function Landing() {
  return (
    <div className="landing">
      <header className="sticky top-0 z-20 border-b border-[var(--landing-line)] bg-[var(--landing-ground)]/95 backdrop-blur-sm">
        <div className="landing-wrap flex items-center justify-between gap-3 py-2">
          <a
            href="#top"
            className="flex min-h-11 items-center gap-2 no-underline"
          >
            <LogoMark />
            <span className="landing-brand">RoadToComply</span>
          </a>
          <nav className="hidden items-center gap-5 md:flex" aria-label="Page">
            <a href={paths.landingHow.hash} className="landing-nav-link">
              How it works
            </a>
            <a href={paths.landingPricing.hash} className="landing-nav-link">
              Pricing
            </a>
            <button
              type="button"
              className="landing-nav-link bg-transparent"
              onClick={() => scrollToId('demo')}
            >
              Contact
            </button>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link to={paths.login} className="landing-nav-link">
              Log in
            </Link>
            <button
              type="button"
              className="landing-btn landing-btn-primary"
              onClick={() => scrollToId('demo')}
            >
              Book a demo
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="landing-wrap grid gap-10 py-16 md:grid-cols-2 md:items-center md:py-24">
          <div className="space-y-6">
            <h1 className="text-4xl leading-tight md:text-5xl">
              Know what's about to lapse — before it does.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed">
              RoadToComply watches every staff certificate and centre requirement
              across all your services, and warns you before anything expires.
              One clear view of where every centre stands.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link to={paths.signup} className="landing-btn landing-btn-primary">
                Start your free month
              </Link>
              <a href={paths.landingHow.hash} className="landing-btn landing-btn-quiet">
                See how it works
              </a>
            </div>
            <p className="max-w-xl text-sm text-[var(--landing-slate)]">
              Your first month is free — no card required. Built for NSW
              multi-site operators, with your data kept in Australia.
            </p>
          </div>

          <div className="grid gap-4">
            <article className="rounded-2xl bg-[var(--landing-expired-bg)] p-6 text-[var(--landing-expired)]">
              <p className="text-sm font-medium">Your platform today</p>
              <p className="mt-3 font-[family-name:var(--landing-heading)] text-6xl leading-none">
                68
              </p>
              <p className="mt-3 text-base leading-relaxed">
                expired documents, sitting in a counter no one acts on
              </p>
              <p className="mt-4 text-sm">Found out after it lapsed</p>
            </article>
            <article className="rounded-2xl bg-[var(--landing-valid-bg)] p-6 text-[var(--landing-valid)]">
              <p className="text-sm font-medium">With RoadToComply</p>
              <p className="mt-3 font-[family-name:var(--landing-heading)] text-6xl leading-none">
                0
              </p>
              <p className="mt-3 text-base leading-relaxed">
                expired, because you were alerted while there was still time
              </p>
              <p className="mt-4 text-sm">Handled before the deadline.</p>
            </article>
          </div>
        </section>

        <section className="bg-[var(--landing-navy)] py-16 text-[#d7e3e0] md:py-20">
          <div className="landing-wrap max-w-3xl space-y-6">
            <p className="text-sm font-medium tracking-wide text-[#8fb9b0] uppercase">
              The problem
            </p>
            <h2 className="text-3xl text-[#f2f6f5] md:text-4xl">
              Your software tracks compliance. It just doesn't warn you.
            </h2>
            <blockquote className="text-xl leading-relaxed italic text-[#e8f0ee]">
              “It doesn't tell me when something's expiring. I find out when
              it's already too late.”
            </blockquote>
            <p className="text-sm text-[#8fb9b0]">
              what operators keep telling us about their current system
            </p>
            <p className="text-base leading-relaxed">
              Running several centres means hundreds of certificates, checks and
              renewals — First Aid, CPR, WWCC, insurances, fire safety — each
              with its own date. Their platform stores them but treats
              compliance as one tile among a hundred, so lapses pile up quietly
              until an assessment or incident surfaces them.
            </p>
          </div>
        </section>

        <section id="how" className="landing-wrap scroll-mt-24 py-16 md:py-20">
          <h2 className="text-3xl md:text-4xl">How it works</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            <li className="space-y-3">
              <p className="text-sm font-medium text-[var(--landing-teal)]">1</p>
              <h3 className="text-xl">Bring your centres in</h3>
              <p className="leading-relaxed">
                Add services and staff, or import your whole roster from a
                spreadsheet in one step.
              </p>
            </li>
            <li className="space-y-3">
              <p className="text-sm font-medium text-[var(--landing-teal)]">2</p>
              <h3 className="text-xl">We track every date</h3>
              <p className="leading-relaxed">
                Each certificate, check and renewal monitored against its
                expiry, per person, per centre.
              </p>
            </li>
            <li className="space-y-3">
              <p className="text-sm font-medium text-[var(--landing-teal)]">3</p>
              <h3 className="text-xl">You're warned in time</h3>
              <p className="leading-relaxed">
                A clear alert before anything lapses, grouped by centre.
              </p>
            </li>
          </ol>
        </section>

        <section className="border-y border-[var(--landing-line)] py-16 md:py-20">
          <div className="landing-wrap">
            <h2 className="text-3xl md:text-4xl">The difference</h2>
            <div className="mt-10 grid gap-5 md:grid-cols-2">
              <article className="rounded-2xl border border-[var(--landing-line)] bg-[var(--landing-paper)] p-6">
                <h3 className="text-xl">Alerts before, not counts after</h3>
                <p className="mt-3 leading-relaxed">
                  Other systems show how many documents already expired; we warn
                  ahead of every renewal with your chosen lead time.
                </p>
              </article>
              <article className="rounded-2xl border border-[var(--landing-line)] bg-[var(--landing-paper)] p-6">
                <h3 className="text-xl">Every centre in one view</h3>
                <p className="mt-3 leading-relaxed">
                  All services on one screen, ranked worst-first.
                </p>
              </article>
              <article className="rounded-2xl border border-[var(--landing-line)] bg-[var(--landing-paper)] p-6">
                <h3 className="text-xl">Staff and centre requirements together</h3>
                <p className="mt-3 leading-relaxed">
                  People's certificates and each centre's own obligations
                  (insurances, fire safety, drills) in one place.
                </p>
              </article>
              <article className="rounded-2xl border border-[var(--landing-line)] bg-[var(--landing-paper)] p-6">
                <h3 className="text-xl">Ready when the regulator is</h3>
                <p className="mt-3 leading-relaxed">
                  Every requirement, its status and evidence in one place for an
                  assessment visit.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="landing-wrap py-16 md:py-20">
          <h2 className="text-3xl md:text-4xl">Who it's for</h2>
          <ul className="mt-8 flex flex-wrap gap-3">
            {[
              'Multi-site private operators',
              'Approved providers',
              'Operations managers',
              'Compliance coordinators',
              'NSW long day care',
            ].map((item) => (
              <li
                key={item}
                className="rounded-full border border-[var(--landing-line)] bg-[var(--landing-paper)] px-4 py-2 text-sm"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="landing-wrap pb-16 md:pb-20">
          <h2 className="text-3xl md:text-4xl">Trust</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            <p className="leading-relaxed">
              Hosted in Australia — data doesn't leave the country.
            </p>
            <p className="leading-relaxed">
              Separated by operator — one account never sees another's records.
            </p>
            <p className="leading-relaxed">
              Only what compliance needs — we don't hold billing, families, or
              payroll.
            </p>
          </div>
        </section>

        <section
          id="pricing"
          className="scroll-mt-24 border-y border-[var(--landing-line)] bg-[var(--landing-paper)] py-16 md:py-20"
        >
          <div className="landing-wrap">
            <p className="text-sm font-medium tracking-wide text-[var(--landing-teal)] uppercase">
              Pricing
            </p>
            <h2 className="mt-3 max-w-2xl text-3xl md:text-4xl">
              Priced per centre. No sales call to find out the number.
            </h2>
            <p className="mt-4 max-w-2xl leading-relaxed">
              The platforms you use today hide their price behind a demo
              booking. Here's ours, in the open.
            </p>

            <div className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <article className="rounded-2xl border border-[var(--landing-line)] p-6 md:p-8">
                <h3 className="text-2xl">
                  Compliance Oversight — $75 per centre, per month
                </h3>
                <p className="mt-3 text-sm">
                  The more centres you run, the lower the rate per centre.
                </p>
                <ul className="mt-6 space-y-2 leading-relaxed">
                  <li>Every staff certificate and centre requirement tracked</li>
                  <li>Expiry alerts before anything lapses</li>
                  <li>All centres in one view, worst-first</li>
                  <li>Alerts grouped by centre</li>
                  <li>Document storage</li>
                  <li>Data hosted in Australia</li>
                </ul>
                <Link
                  to={paths.signup}
                  className="landing-btn landing-btn-primary mt-8"
                >
                  Start your free month
                </Link>
                <p className="mt-3 text-sm">
                  Your first month is free — no card required.
                </p>
              </article>

              <aside className="rounded-2xl bg-[var(--landing-ground)] p-6 md:p-8">
                <h3 className="text-xl">What it costs as you grow</h3>
                <ul className="mt-5 space-y-3">
                  <li>1–4 centres · $75 / centre</li>
                  <li>5–15 centres · $65 / centre</li>
                  <li>16+ centres · $55 / centre</li>
                </ul>
                <p className="mt-5 leading-relaxed">
                  Each band is charged at its own rate, so adding a centre
                  always lowers the average.
                </p>
                <p className="mt-4">
                  <button
                    type="button"
                    className="landing-btn-quiet bg-transparent p-0"
                    onClick={() => scrollToId('demo')}
                  >
                    Running a large group? Ask for a quote.
                  </button>
                </p>
                <p className="mt-6 text-sm text-[var(--landing-slate)]">
                  Paperless forms, immunisation tracking and integrations are on
                  the way as higher plans.
                </p>
              </aside>
            </div>
          </div>
        </section>

        <section id="demo" className="landing-wrap scroll-mt-24 py-16 md:py-24">
          <h2 className="max-w-2xl text-3xl md:text-4xl">
            See where every centre stands — in fifteen minutes.
          </h2>
          <p className="mt-4 max-w-xl leading-relaxed">
            A short walkthrough, no commitment. A hands-on trial when you are
            ready.
          </p>
          <CopyEmailButton />
        </section>
      </main>

      <footer className="border-t border-[var(--landing-line)] py-10">
        <div className="landing-wrap space-y-4 text-sm">
          <p className="max-w-xl leading-relaxed">
            RoadToComply watches every staff certificate and centre requirement
            across all your services.
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to={paths.privacy} className="landing-nav-link">
              Privacy
            </Link>
            <span aria-hidden>·</span>
            <Link to={paths.terms} className="landing-nav-link">
              Terms
            </Link>
            <span aria-hidden>·</span>
            <Link to={paths.security} className="landing-nav-link">
              Security
            </Link>
          </p>
          <p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="select-all underline underline-offset-4"
            >
              {CONTACT_EMAIL}
            </a>
          </p>
          <p>© 2026 RoadToComply</p>
          <p>Made in Australia.</p>
        </div>
      </footer>
    </div>
  )
}
