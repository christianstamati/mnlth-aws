/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "mnlth",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: {
        aws: {
          region: "eu-central-1",
          // Local deploys use the "personal" profile; CI runners bring their own role
          profile: process.env.CI ? undefined : "personal",
        },
      },
    }
  },
  async run() {
    const web = new sst.aws.TanStackStart("Web", {
      path: "apps/web",
      buildCommand: "bun run build",
      environment: {
        VITE_CONVEX_URL: "https://enduring-ocelot-688.eu-west-1.convex.cloud",
      },
    })

    return {
      web: web.url,
    }
  },
})
