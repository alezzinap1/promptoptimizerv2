import type { Dict } from './ru'

/*
 * English dictionary. Same shape as ru.ts (enforced by `Dict`).
 * Translation style: plain, product-first, mirrors RU register rather
 * than over-translating the technical jargon (A/B stays A/B, etc.).
 */

const en: Dict = {
  lang: { name: 'EN', full: 'English' },

  common: {
    login: 'Sign in',
    loading: 'Loading…',
    back: 'Back',
    next: 'Next',
    skip: 'Skip',
    done: 'Done',
    cancel: 'Cancel',
    retry: 'Retry',
    copy: 'Copy',
    languageSwitch: 'Interface language',
  },

  palette: {
    open: 'Commands',
    hint: '⌘K',
    placeholder: 'Search commands and sessions…',
    empty: 'Nothing matched',
    groups: {
      navigate: 'Go to',
      actions: 'Actions',
      recent: 'Recent sessions',
      admin: 'Admin',
    },
    cmd: {
      goStudio: 'Open Studio',
      goSimple: 'Open Improve',
      goCompare: 'Open A/B Compare',
      goLibrary: 'Open library',
      goCommunity: 'Open community',
      goModels: 'Open Models',
      goWorkspaces: 'Workspaces',
      goPresets: 'Presets',
      goSettings: 'Settings',
      goUserInfo: 'Profile & metrics',
      goHelp: 'Help',
      goAdmin: 'Admin panel',
      themeLight: 'Switch theme: light',
      themeDark: 'Switch theme: dark',
      langRu: 'Language: Russian',
      langEn: 'Language: English',
      signOut: 'Sign out',
      signIn: 'Sign in',
    },
    sessionPrefix: 'Open session: ',
  },

  header: {
    modeStudio: 'Studio',
    modeSimple: 'Improve',
    logoAriaHome: 'Home',
    workspaceLoading: 'Loading…',
    workspaceFallback: 'Workspace #{id}',
    demoBanner: 'Guest demo: server requests are disabled.',
    demoBannerLogin: 'Sign in',
    demoBannerTail: ' to work with your data.',
  },

  landing: {
    hero: {
      eyebrow: 'STUDIO · v0.9',
      titleHead: 'From a rough task to a prompt that ',
      titleTail: '.',
      rotatingWords: ['works', 'understands', 'holds up', 'repeats', 'tests itself'],
      subtitle:
        'One sentence in — a structured prompt out. Try it right here, no sign-in.',
      ctaPrimary: 'Open Studio →',
      ctaGhost: 'What it does',
      footnote: 'No keys. No sign-up. No promises.',
    },
    composer: {
      title: 'Live demo',
      tag: 'DEMO',
      placeholder:
        'Write a product description for an e-commerce store — concise, no ad tone.',
      rate: '5 / 5 min',
      submit: 'Generate',
      submitting: 'Generating',
      errorShort: 'Describe the task in at least one sentence.',
      errorNetwork: 'Demo is temporarily unavailable.',
      taskAria: 'Task for the demo',
      actions: {
        copy: 'Copy',
        openStudio: 'Open in Studio',
        regen: 'Another take',
      },
      arrowLabel: 'live · no login',
    },
    ticker: {
      stack: 'stack',
      tierFast: 'tier=fast',
      tierMid: 'tier=mid',
      tierAdvanced: 'tier=advanced',
      uptime: 'uptime',
      maxOut: 'max out',
      health: 'health',
      vision: 'vision',
      stackValue: 'auto · mid · advanced',
      uptimeValue: '30d · 99.2%',
      maxOutValue: '≤ $3 / 1M tokens',
      healthValue: '6/6 green',
      visionValue: 'degraded · fallback ok',
    },
    how: {
      num: '01',
      title: 'What it does',
      lede: 'Three things this does better than a bare chat.',
      cards: [
        {
          num: '01',
          title: 'Compose',
          body: 'A one-line task becomes a full prompt — role, context, constraints, output format. Edit by hand if you want, but often you won\u2019t need to.',
        },
        {
          num: '02',
          title: 'Compare',
          body: 'A/B two versions on the same task: techniques, models, or whole prompts. A judge scores each on explicit criteria, not vibes.',
        },
        {
          num: '03',
          title: 'Keep',
          body: 'A library with tags, versions, diffs and smart views. Working prompts live next to the studio, not buried in bookmarks.',
        },
      ],
    },
    forWho: {
      num: '02',
      title: 'Who it\u2019s for',
      beginner: {
        badge: 'New',
        title: 'If you use LLMs but have no system',
        points: [
          'You don\u2019t need to know the words "few-shot" or "chain-of-thought".',
          'Starter templates and examples in the composer.',
          'One-click RU ⇄ EN translation, no LLM involved.',
        ],
      },
      engineer: {
        badge: 'Pro',
        title: 'If prompts are part of your job',
        points: [
          'Auto / Fast / Mid / Advanced instead of manual model picking.',
          'Run A/B on the target model with diffs and criteria-based judging.',
          'Your own OpenRouter key removes host-side limits.',
        ],
      },
    },
    trust: {
      num: '03',
      title: 'Models under the hood',
      lede: 'Checked daily. If one goes down, we swap in an equivalent from the same price bucket.',
      modes: { text: 'Text', vision: 'Vision' },
      tiers: { auto: 'Auto', fast: 'Fast', mid: 'Mid', advanced: 'Advanced' },
      footnote: 'Last healthcheck snapshot · TTL 5 min · more at /admin/model-health',
    },
    faq: {
      num: '04',
      title: 'Common questions',
      rows: [
        {
          q: 'Why would I bring my own OpenRouter key?',
          a: 'With your key you pay providers directly and can pick any model. Without it, the trial mode covers host-side limits — enough to get the feel.',
        },
        {
          q: 'What\u2019s the trial mode, and what are the limits?',
          a: 'A token budget on sign-up plus 10 generations per 5 minutes and a daily A/B compare budget. Exact numbers are in your profile.',
        },
        {
          q: 'What do you store?',
          a: 'Nothing from this demo widget. Once signed in: your library, session history and settings. Task text reaches LLM providers only for the response.',
        },
        {
          q: 'Auto / Fast / Mid / Advanced — what is that?',
          a: 'Task tiers, not specific models. Auto picks for you; Fast is cheap and quick; Mid is the balance; Advanced handles long reasoning. Underlying models can change — we keep outputs reproducible.',
        },
        {
          q: 'Can I try without signing up?',
          a: 'The demo above — yes. For Studio, library and A/B you need an account. Free.',
        },
        {
          q: 'How do you score completeness?',
          a: 'A heuristic over text structure: role, constraints, output format, examples. It\u2019s a fast filter, not a replacement for an LLM judge.',
        },
      ],
    },
    footer: {
      brand: 'MetaPrompt · 2026',
      loginLink: 'Sign in',
      githubLink: 'GitHub',
      howLink: 'How it works',
    },
  },

  auth: {
    brand: {
      title: 'MetaPrompt',
      subtitle:
        'Optimize prompts with AI. Create, test and improve your prompts in one place.',
      features: {
        library: 'Prompt library',
        analytics: 'Analytics & metrics',
        history: 'Version history',
      },
    },
    login: {
      title: 'Welcome back',
      caption: 'Sign in to continue working',
      submit: 'Sign in',
      tab: 'Sign in',
    },
    register: {
      title: 'Create an account',
      caption: 'Sign up to get started',
      submit: 'Create account',
      tab: 'Sign up',
    },
    placeholder: {
      username: 'Username',
      email: 'Email',
      password: 'Password',
      password2: 'Confirm password',
    },
    submitting: 'Please wait…',
    divider: 'or',
    github: {
      login: 'Sign in with GitHub',
      register: 'Sign up with GitHub',
    },
    demo: 'Continue as guest (Demo)',
    demoBanner: 'Guest demo: server requests are disabled.',
    demoBannerLogin: 'Sign in',
    demoBannerTail: ' to work with your data.',
    errors: {
      passwordMismatch: 'Passwords don\u2019t match',
      emailRequired: 'Enter your email',
      generic: 'Authorization error',
      github: 'Couldn\u2019t sign in with GitHub. Try again.',
      githubDisabled: 'Account disabled. Contact an administrator.',
    },
  },

  library: {
    views: {
      label: 'Views',
      all: 'All',
      recent: 'Recent',
      best: 'Top by rating',
      stale: 'Untouched',
      untagged: 'Untagged',
    },
    starters: {
      eyebrow: 'Starters',
      title: 'Your library is empty',
      lede: 'Seed one of these templates — you can rework it like any prompt.',
      add: 'Add',
      adding: 'Adding…',
      added: 'Added',
      failed: 'Failed',
      goalTag: { work: 'for work', study: 'for study', own: 'for your projects' },
    },
    searchPlaceholder: 'Search by text and tags…',
  },

  notFound: {
    title: 'Page not found',
    body: 'The link is stale or points to a private part of the product.',
    cta: 'Home',
  },

  privateOnly: {
    title: 'Sign-in required',
    body: 'Sign in to open this section.',
    tryDemo: 'Try without signing up',
  },

  onboarding: {
    progress: 'Step {current} of {total}',
    skip: 'Skip',
    back: 'Back',
    next: 'Next',
    step1: {
      eyebrow: '01 · WHY',
      title: 'What do you need prompts for?',
      lede: 'Pick one — it shapes the starter hints. You can change it later.',
      goals: [
        { id: 'work', label: 'Work', hint: 'Docs, emails, code, marketing, analytics.' },
        { id: 'study', label: 'Study', hint: 'Summaries, outlines, argument checks.' },
        { id: 'own', label: 'Own thing', hint: 'Content, ideas, scripts, experiments.' },
      ],
    },
    step2: {
      eyebrow: '02 · HOW',
      title: 'What complexity do you usually work at?',
      lede: 'Pick a default tier. You can change it on each request.',
      tiers: [
        {
          id: 'auto',
          label: 'Auto',
          body: 'The product picks the model for the task. Best starting point.',
        },
        {
          id: 'fast',
          label: 'Fast',
          body: 'Short tasks, templates, quick iterations.',
        },
        {
          id: 'mid',
          label: 'Mid',
          body: 'Balance. Most everyday work.',
        },
        {
          id: 'advanced',
          label: 'Advanced',
          body: 'Long reasoning, heavy context.',
        },
      ],
    },
    step3: {
      eyebrow: '03 · TRY',
      title: 'Build your first prompt',
      lede: 'Describe a task in one or two sentences. The product turns it into a structured prompt and saves it in your sessions.',
      placeholder: 'Write a blog post for our company about launching a new product.',
      submit: 'Build the prompt',
      submitting: 'Building',
      errorShort: 'Describe the task in at least one sentence.',
      errorNetwork: 'Couldn\u2019t generate. Try again.',
      resultTitle: 'Done — this is your first prompt',
      actions: {
        openStudio: 'Open in Studio →',
        again: 'Try another task',
      },
      suggestionsTitle: 'Ideas:',
      suggestionsByGoal: {
        work: [
          'Draft an email to a client about a project delay.',
          'Make release notes from these commits: …',
          'Summarise weekly KPIs from these metrics.',
        ],
        study: [
          'Plan exam prep for linear algebra over two weeks.',
          'Compare two papers on the same methodology.',
          'Compress this text into 10 thesis points, grouped by topic.',
        ],
        own: [
          'Tagline and three subheads for a product about …',
          'Landing offer for a course on …',
          'Five content topic ideas for a Telegram channel.',
        ],
      },
    },
    done: {
      title: 'You\u2019re in Studio',
      body: 'Your first session is saved — it\u2019s already in the list on the left.',
      cta: 'Go to Studio',
    },
  },
}

export default en
