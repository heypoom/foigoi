import * as Sentry from '@sentry/react'

Sentry.init({
  dsn: 'https://2a9a86ec5e5728b5cd5ff1217b88a59a@o230370.ingest.us.sentry.io/4507582603198464',

  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],

  // Performance Monitoring
  tracesSampleRate: 0.9, //  Capture 100% of the transactions

  // Set 'tracePropagationTargets' to control for which URLs distributed tracing should be enabled
  tracePropagationTargets: ['localhost', /^https:\/\/foigoi-api\.poom\.dev/],

  // Session Replay
  replaysSessionSampleRate: 0.2, // sample 80% of the sessions
  replaysOnErrorSampleRate: 0.3, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur.
})
