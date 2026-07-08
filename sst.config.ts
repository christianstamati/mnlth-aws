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
    // ── Self-hosted Convex backend ─────────────────────────────────────
    const vpc = new sst.aws.Vpc("Vpc", { nat: "ec2" })
    const cluster = new sst.aws.Cluster("Cluster", { vpc })

    // 64-char hex string; set once with `sst secret set ConvexInstanceSecret <value>`
    const instanceSecret = new sst.Secret("ConvexInstanceSecret")

    const db = new sst.aws.Postgres("ConvexDb", {
      vpc,
      // Convex requires the database to be named after INSTANCE_NAME
      // (hyphens replaced by underscores)
      database: "mnlth",
      transform: {
        parameterGroup: {
          // Convex's Rust client can't verify Amazon's private RDS CA, so SSL
          // stays off; traffic never leaves the VPC's private subnets
          parameters: [{ name: "rds.force_ssl", value: "0" }],
        },
      },
    })

    const buckets = {
      exports: new sst.aws.Bucket("ConvexExports"),
      snapshotImports: new sst.aws.Bucket("ConvexSnapshotImports"),
      modules: new sst.aws.Bucket("ConvexModules"),
      files: new sst.aws.Bucket("ConvexFiles"),
      search: new sst.aws.Bucket("ConvexSearch"),
    }

    // HTTPS entry points (CloudFront) for the two Convex origins.
    // The ALB DNS name is a constant to break the circular dependency between
    // the CloudFront origins (need the ALB host) and the ECS service env
    // (needs the CloudFront URLs). Update it if the ALB is ever recreated.
    const convexAlbDomain =
      "convexloadbalan-ohmeznhr-1133385690.eu-central-1.elb.amazonaws.com"

    // AWS managed policies: CachingDisabled + AllViewerExceptHostHeader
    const cachingDisabled = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    const allViewerExceptHost = "b689b0a8-53d0-40ab-baf2-68738e2966ac"

    const convexDistribution = (name: string, originPort: number) =>
      new aws.cloudfront.Distribution(name, {
        enabled: true,
        origins: [
          {
            originId: "convex-alb",
            domainName: convexAlbDomain,
            customOriginConfig: {
              httpPort: originPort,
              httpsPort: 443,
              originProtocolPolicy: "http-only",
              originSslProtocols: ["TLSv1.2"],
              originReadTimeout: 60,
            },
          },
        ],
        defaultCacheBehavior: {
          targetOriginId: "convex-alb",
          viewerProtocolPolicy: "redirect-to-https",
          allowedMethods: [
            "DELETE",
            "GET",
            "HEAD",
            "OPTIONS",
            "PATCH",
            "POST",
            "PUT",
          ],
          cachedMethods: ["GET", "HEAD"],
          cachePolicyId: cachingDisabled,
          originRequestPolicyId: allViewerExceptHost,
        },
        restrictions: { geoRestriction: { restrictionType: "none" } },
        viewerCertificate: { cloudfrontDefaultCertificate: true },
        httpVersion: "http2",
        priceClass: "PriceClass_100",
      })

    const convexApiCdn = convexDistribution("ConvexApiCdn", 80)
    const convexSiteCdn = convexDistribution("ConvexSiteCdn", 3211)
    const convexCloudUrl = $interpolate`https://${convexApiCdn.domainName}`
    const convexSiteUrl = $interpolate`https://${convexSiteCdn.domainName}`

    const convex = new sst.aws.Service("Convex", {
      cluster,
      image: "ghcr.io/get-convex/convex-backend:latest",
      cpu: "1 vCPU",
      memory: "2 GB",
      link: Object.values(buckets),
      environment: {
        INSTANCE_NAME: "mnlth",
        INSTANCE_SECRET: instanceSecret.value,
        CONVEX_CLOUD_ORIGIN: convexCloudUrl,
        CONVEX_SITE_ORIGIN: convexSiteUrl,
        // sslmode=disable: the backend's Rust TLS stack can't verify Amazon's
        // private RDS CA; traffic stays inside the VPC's private subnets
        POSTGRES_URL: $interpolate`postgresql://${db.username}:${db.password.apply(
          encodeURIComponent
        )}@${db.host}:${db.port}?sslmode=disable`,
        DO_NOT_REQUIRE_SSL: "1",
        AWS_REGION: "eu-central-1",
        S3_STORAGE_EXPORTS_BUCKET: buckets.exports.name,
        S3_STORAGE_SNAPSHOT_IMPORTS_BUCKET: buckets.snapshotImports.name,
        S3_STORAGE_MODULES_BUCKET: buckets.modules.name,
        S3_STORAGE_FILES_BUCKET: buckets.files.name,
        S3_STORAGE_SEARCH_BUCKET: buckets.search.name,
        RUST_LOG: "info",
        DISABLE_BEACON: "true",
      },
      loadBalancer: {
        rules: [
          { listen: "80/http", forward: "3210/http" },
          // CloudFront can only reach origins on ports 80/443/1024+, so the
          // site proxy listener sits on 3211 rather than 81
          { listen: "3211/http", forward: "3211/http" },
        ],
        health: {
          "3210/http": { path: "/version" },
          // The site proxy 404s on unknown routes; that still means alive
          "3211/http": { path: "/", successCodes: "200-404" },
        },
      },
    })

    // ── Web app ────────────────────────────────────────────────────────
    const web = new sst.aws.TanStackStart("Web", {
      path: "apps/web",
      buildCommand: "bun run build",
      environment: {
        // Still pointing at Convex Cloud; flips to convexApi.url after the
        // data migration (step 3)
        VITE_CONVEX_URL: "https://enduring-ocelot-688.eu-west-1.convex.cloud",
      },
    })

    return {
      web: web.url,
      convexApi: convexCloudUrl,
      convexSite: convexSiteUrl,
    }
  },
})
