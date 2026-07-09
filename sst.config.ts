/// <reference path="./.sst/platform/config.d.ts" />

// Reports deploys to GitHub (Environments panel + "View deployment" on PRs
// + preview-URL comment), mirroring Vercel's integration. Requires a
// fine-grained PAT in the runner env as GITHUB_TOKEN (SST Console → app
// settings → Autodeploy → Environment variables); silently no-ops without it.
// biome-ignore lint/suspicious/noExplicitAny: event shape comes from SST at runtime
function createGithubReporter(event: any, stage: string | undefined) {
  const token = process.env.GITHUB_TOKEN
  const owner = event.repo?.owner
  const repo = event.repo?.repo
  const enabled = Boolean(token && owner && repo && stage)
  const environment = stage === "production" ? "Production" : "Preview"
  let deploymentId: number | undefined

  // biome-ignore lint/suspicious/noExplicitAny: generic GitHub API payloads
  async function api(path: string, init?: any): Promise<any> {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    })
    if (!res.ok)
      throw new Error(`GitHub ${path}: ${res.status} ${await res.text()}`)
    return res.status === 204 ? null : res.json()
  }

  return {
    async report(state: "success" | "failure", url?: string) {
      if (!enabled) {
        console.log("GITHUB_TOKEN not set — skipping GitHub deployment status")
        return
      }
      try {
        if (!deploymentId) {
          const dep = await api(`/repos/${owner}/${repo}/deployments`, {
            method: "POST",
            body: JSON.stringify({
              ref: event.commit.id,
              environment,
              auto_merge: false,
              required_contexts: [],
              transient_environment: stage !== "production",
              production_environment: stage === "production",
              description: `sst deploy ${stage}`,
            }),
          })
          deploymentId = dep.id
        }
        await api(
          `/repos/${owner}/${repo}/deployments/${deploymentId}/statuses`,
          {
            method: "POST",
            body: JSON.stringify({
              state,
              environment_url: url,
              auto_inactive: true,
            }),
          }
        )
      } catch (error) {
        console.log("GitHub deployment reporting failed:", error)
      }
    },

    async comment(url: string) {
      if (!enabled || event.type !== "pull_request") return
      try {
        const marker = "<!-- sst-preview-url -->"
        const body = `${marker}\n🔍 **Preview deployed**: ${url}\n\n_Stage \`${stage}\` · commit ${event.commit.id.slice(0, 7)}_`
        const comments = await api(
          `/repos/${owner}/${repo}/issues/${event.number}/comments`
        )
        // biome-ignore lint/suspicious/noExplicitAny: GitHub API payload
        const existing = comments.find((c: any) => c.body?.includes(marker))
        if (existing) {
          await api(`/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
            method: "PATCH",
            body: JSON.stringify({ body }),
          })
        } else {
          await api(`/repos/${owner}/${repo}/issues/${event.number}/comments`, {
            method: "POST",
            body: JSON.stringify({ body }),
          })
        }
      } catch (error) {
        console.log("GitHub PR comment failed:", error)
      }
    },
  }
}

export default $config({
  app(input) {
    return {
      name: "mnlth",
      // Teardown mode (2026-07-09): protection lifted so `sst remove` can
      // delete production. Restore removal:"retain" + protect on production
      // before ever deploying this stack again.
      removal: "remove",
      protect: false,
      home: "aws",
      providers: {
        aws: {
          region: "eu-central-1",
          // Local deploys use the "personal" profile; CI runners bring their own role
          profile: process.env.CI ? undefined : "personal",
        },
        command: "1.2.1",
      },
    }
  },
  console: {
    autodeploy: {
      target() {
        // Autodeploy disabled — infrastructure torn down 2026-07-09.
        // Restore the main→production and PR→pr-<n> mappings to re-enable.
        return undefined
      },
      runner: {
        cache: {
          paths: [
            "node_modules",
            "apps/web/node_modules",
            "packages/backend/node_modules",
            "packages/ui/node_modules",
          ],
        },
      },
      async workflow({ $, event }) {
        const stage =
          event.type === "branch" && event.branch === "main"
            ? "production"
            : event.type === "pull_request"
              ? `pr-${event.number}`
              : undefined
        const github = createGithubReporter(event, stage)

        await $`bun install --frozen-lockfile`

        if (event.action === "removed") {
          await $`bunx sst remove`
          return
        }

        try {
          await $`bunx sst deploy`
        } catch (error) {
          await github.report("failure")
          throw error
        }

        let url: string | undefined
        try {
          const { readFileSync } = await import("node:fs")
          url = JSON.parse(readFileSync(".sst/outputs.json", "utf8")).web
        } catch {
          console.log("could not read .sst/outputs.json — no URL to report")
        }

        await github.report("success", url)
        if (url) await github.comment(url)
      },
    },
  },
  async run() {
    const isProduction = $app.stage === "production"

    const CONVEX_IMAGE = "ghcr.io/get-convex/convex-backend:latest"

    // HTTPS entry points (CloudFront) for the Convex origins.
    // The ALB DNS name is a constant to break the circular dependency between
    // the CloudFront origins (need the ALB host) and the ECS service env
    // (needs the CloudFront URLs). Update it if the ALB is ever recreated.
    const convexAlbDomain =
      "convexloadbalan-ohmeznhr-1133385690.eu-central-1.elb.amazonaws.com"

    // AWS managed policies: CachingDisabled + AllViewerExceptHostHeader
    const cachingDisabled = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    const allViewerExceptHost = "b689b0a8-53d0-40ab-baf2-68738e2966ac"

    // stageHeader: preview distributions tag requests with x-mnlth-stage so
    // ALB listener rules can route them to that stage's containers
    const convexDistribution = (
      name: string,
      originPort: number,
      stageHeader?: string
    ) =>
      new aws.cloudfront.Distribution(name, {
        enabled: true,
        origins: [
          {
            originId: "convex-alb",
            domainName: convexAlbDomain,
            ...(stageHeader
              ? {
                  customHeaders: [
                    { name: "x-mnlth-stage", value: stageHeader },
                  ],
                }
              : {}),
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

    const convexEnv = (args: {
      instanceName: string
      instanceSecret: $util.Output<string>
      cloudOrigin: $util.Output<string>
      siteOrigin: $util.Output<string>
      postgresUrl: $util.Output<string>
      buckets: Record<string, sst.aws.Bucket>
    }) => ({
      INSTANCE_NAME: args.instanceName,
      INSTANCE_SECRET: args.instanceSecret,
      CONVEX_CLOUD_ORIGIN: args.cloudOrigin,
      CONVEX_SITE_ORIGIN: args.siteOrigin,
      // sslmode=disable: the backend's Rust TLS stack can't verify Amazon's
      // private RDS CA; traffic never leaves the VPC's private subnets
      POSTGRES_URL: args.postgresUrl,
      DO_NOT_REQUIRE_SSL: "1",
      AWS_REGION: "eu-central-1",
      S3_STORAGE_EXPORTS_BUCKET: args.buckets.exports.name,
      S3_STORAGE_SNAPSHOT_IMPORTS_BUCKET: args.buckets.snapshotImports.name,
      S3_STORAGE_MODULES_BUCKET: args.buckets.modules.name,
      S3_STORAGE_FILES_BUCKET: args.buckets.files.name,
      S3_STORAGE_SEARCH_BUCKET: args.buckets.search.name,
      RUST_LOG: "info",
      DISABLE_BEACON: "true",
    })

    let convexUrl: string | $util.Output<string>

    if (isProduction) {
      // ── Self-hosted Convex backend (production) ───────────────────────
      const vpc = new sst.aws.Vpc("Vpc", { nat: "ec2" })
      const cluster = new sst.aws.Cluster("Cluster", { vpc })

      // 64-char hex string; set once with `sst secret set ConvexInstanceSecret <value>`
      const instanceSecret = new sst.Secret("ConvexInstanceSecret")
      // Derived from the instance secret; set with `sst secret set ConvexAdminKey <value>`
      const adminKey = new sst.Secret("ConvexAdminKey")

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

      const convexApiCdn = convexDistribution("ConvexApiCdn", 80)
      const convexSiteCdn = convexDistribution("ConvexSiteCdn", 3211)
      const convexCloudUrl = $interpolate`https://${convexApiCdn.domainName}`
      const convexSiteUrl = $interpolate`https://${convexSiteCdn.domainName}`
      convexUrl = convexCloudUrl

      const convex = new sst.aws.Service("Convex", {
        cluster,
        image: "ghcr.io/get-convex/convex-backend:latest",
        cpu: "1 vCPU",
        memory: "2 GB",
        link: Object.values(buckets),
        environment: convexEnv({
          instanceName: "mnlth",
          instanceSecret: instanceSecret.value,
          cloudOrigin: convexCloudUrl,
          siteOrigin: convexSiteUrl,
          postgresUrl: $interpolate`postgresql://${db.username}:${db.password.apply(
            encodeURIComponent
          )}@${db.host}:${db.port}?sslmode=disable`,
          buckets,
        }),
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

      // Push Convex functions on every production deploy (the equivalent of
      // the old Vercel build step). Runs wherever `sst deploy` runs.
      new command.local.Command(
        "ConvexFunctionsDeploy",
        {
          dir: `${process.cwd()}/packages/backend`,
          create: "bunx convex deploy --yes",
          update: "bunx convex deploy --yes",
          environment: {
            // Blank out the dev deployment from .env.local
            CONVEX_DEPLOYMENT: "",
            CONVEX_SELF_HOSTED_URL: convexCloudUrl,
            CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey.value,
          },
          // Changes every deploy so the functions are always pushed
          triggers: [Date.now()],
        },
        { dependsOn: [convex] }
      )
    } else {
      // ── Isolated preview backend ───────────────────────────────────────
      // Each preview stage runs its own Convex instance: own Fargate task,
      // own database on the shared RDS server, own buckets, own CloudFront
      // URLs. It reuses production's VPC and ALB (routed by the
      // x-mnlth-stage header) so no slow/expensive plumbing is created.
      // Constants come from the production stage; update if that changes.
      const prod = {
        vpcId: "vpc-0a8f0951a2bffc1b6",
        albSecurityGroup: "sg-00e32dbf0350cad64",
        listener80:
          "arn:aws:elasticloadbalancing:eu-central-1:706655923704:listener/app/ConvexLoadBalan-ohmeznhr/d90737e0a7ceedce/7f98ed7accb14812",
        listener3211:
          "arn:aws:elasticloadbalancing:eu-central-1:706655923704:listener/app/ConvexLoadBalan-ohmeznhr/d90737e0a7ceedce/6eb0e8570a9a6ecf",
        privateSubnets: [
          "subnet-05fc76d893fe7eb88",
          "subnet-06edbb7411a93497e",
        ],
      }

      const instanceName = `mnlth-${$app.stage}`
      const databaseName = instanceName.replace(/-/g, "_")
      // Listener-rule priorities must be unique per stage (range 1–50000)
      const prNumber = $app.stage.match(/^pr-(\d+)$/)?.[1]
      const rulePriority = prNumber
        ? 100 + (Number(prNumber) % 800)
        : 1000 +
          [...$app.stage].reduce(
            (hash, char) => (hash * 31 + char.charCodeAt(0)) % 900,
            0
          )

      const vpc = sst.aws.Vpc.get("Vpc", prod.vpcId)
      const cluster = new sst.aws.Cluster("PreviewCluster", { vpc })
      const instanceSecret = new sst.Secret("ConvexInstanceSecret")
      const postgresUrl = new sst.Secret("ConvexPostgresUrl")

      const buckets = {
        exports: new sst.aws.Bucket("ConvexExports"),
        snapshotImports: new sst.aws.Bucket("ConvexSnapshotImports"),
        modules: new sst.aws.Bucket("ConvexModules"),
        files: new sst.aws.Bucket("ConvexFiles"),
        search: new sst.aws.Bucket("ConvexSearch"),
      }

      // Create this stage's database on the shared RDS server (in-VPC Lambda)
      const dbProvisioner = new sst.aws.Function("PreviewDbProvision", {
        handler: "infra/preview-db.handler",
        vpc,
        timeout: "1 minute",
        environment: { POSTGRES_URL: postgresUrl.value },
      })
      const dbReady = new aws.lambda.Invocation("PreviewDbReady", {
        functionName: dbProvisioner.name,
        input: JSON.stringify({ database: databaseName }),
      })

      const convexApiCdn = convexDistribution("ConvexApiCdn", 80, $app.stage)
      const convexSiteCdn = convexDistribution(
        "ConvexSiteCdn",
        3211,
        $app.stage
      )
      const convexCloudUrl = $interpolate`https://${convexApiCdn.domainName}`
      const convexSiteUrl = $interpolate`https://${convexSiteCdn.domainName}`
      convexUrl = convexCloudUrl

      const apiTarget = new aws.lb.TargetGroup("PreviewApiTarget", {
        namePrefix: "cvapi",
        port: 3210,
        protocol: "HTTP",
        targetType: "ip",
        vpcId: prod.vpcId,
        healthCheck: {
          path: "/version",
          matcher: "200",
          interval: 15,
          healthyThreshold: 2,
        },
        deregistrationDelay: 30,
      })
      const siteTarget = new aws.lb.TargetGroup("PreviewSiteTarget", {
        namePrefix: "cvsit",
        port: 3211,
        protocol: "HTTP",
        targetType: "ip",
        vpcId: prod.vpcId,
        healthCheck: {
          path: "/",
          // The site proxy 404s on unknown routes; that still means alive
          matcher: "200-404",
          interval: 15,
          healthyThreshold: 2,
        },
        deregistrationDelay: 30,
      })
      new aws.lb.ListenerRule("PreviewApiRule", {
        listenerArn: prod.listener80,
        priority: rulePriority,
        conditions: [
          {
            httpHeader: {
              httpHeaderName: "x-mnlth-stage",
              values: [$app.stage],
            },
          },
        ],
        actions: [{ type: "forward", targetGroupArn: apiTarget.arn }],
      })
      new aws.lb.ListenerRule("PreviewSiteRule", {
        listenerArn: prod.listener3211,
        priority: rulePriority,
        conditions: [
          {
            httpHeader: {
              httpHeaderName: "x-mnlth-stage",
              values: [$app.stage],
            },
          },
        ],
        actions: [{ type: "forward", targetGroupArn: siteTarget.arn }],
      })

      const taskSecurityGroup = new aws.ec2.SecurityGroup("PreviewTaskSg", {
        vpcId: prod.vpcId,
        ingress: [
          {
            fromPort: 3210,
            toPort: 3211,
            protocol: "tcp",
            securityGroups: [prod.albSecurityGroup],
          },
        ],
        egress: [
          { fromPort: 0, toPort: 0, protocol: "-1", cidrBlocks: ["0.0.0.0/0"] },
        ],
      })

      const convex = new sst.aws.Service(
        "Convex",
        {
          cluster,
          image: CONVEX_IMAGE,
          cpu: "0.5 vCPU",
          memory: "1 GB",
          link: Object.values(buckets),
          environment: convexEnv({
            instanceName,
            instanceSecret: instanceSecret.value,
            cloudOrigin: convexCloudUrl,
            siteOrigin: convexSiteUrl,
            postgresUrl: $interpolate`${postgresUrl.value}?sslmode=disable`,
            buckets,
          }),
          transform: {
            taskDefinition: (args) => {
              // SST only adds portMappings when it manages a load balancer;
              // we attach to production's ALB ourselves, so add them here
              args.containerDefinitions = $output(
                args.containerDefinitions
              ).apply((defs) => {
                const parsed = JSON.parse(defs as string)
                parsed[0].portMappings = [
                  { containerPort: 3210, protocol: "tcp" },
                  { containerPort: 3211, protocol: "tcp" },
                ]
                return JSON.stringify(parsed)
              })
            },
            service: (args) => {
              args.loadBalancers = [
                {
                  targetGroupArn: apiTarget.arn,
                  containerName: "Convex",
                  containerPort: 3210,
                },
                {
                  targetGroupArn: siteTarget.arn,
                  containerName: "Convex",
                  containerPort: 3211,
                },
              ]
              args.networkConfiguration = {
                subnets: prod.privateSubnets,
                securityGroups: [taskSecurityGroup.id],
                assignPublicIp: false,
              }
              args.healthCheckGracePeriodSeconds = 120
            },
          },
        },
        { dependsOn: [dbReady] }
      )

      // Deploy this branch's functions to the preview backend. The admin key
      // is derived from the instance name + secret via the convex image
      // (docker is available locally and on the CI runner).
      // Wait for the backend to answer through CloudFront (task boot + health
      // checks take a couple of minutes on a fresh stage), then deploy
      const previewDeployCommand = `for i in $(seq 1 60); do curl -sf --max-time 5 "$CONVEX_SELF_HOSTED_URL/version" >/dev/null && break; echo "waiting for preview backend ($i)"; sleep 5; done && ADMIN_KEY=$(docker run --rm --entrypoint ./generate_admin_key.sh -e INSTANCE_NAME -e INSTANCE_SECRET ${CONVEX_IMAGE} | tail -1) && CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY" bunx convex deploy --yes`
      new command.local.Command(
        "ConvexFunctionsDeploy",
        {
          dir: `${process.cwd()}/packages/backend`,
          create: previewDeployCommand,
          update: previewDeployCommand,
          environment: {
            // Blank out the dev deployment from .env.local
            CONVEX_DEPLOYMENT: "",
            INSTANCE_NAME: instanceName,
            INSTANCE_SECRET: instanceSecret.value,
            CONVEX_SELF_HOSTED_URL: convexCloudUrl,
          },
          // Changes every deploy so the functions are always pushed
          triggers: [Date.now()],
        },
        { dependsOn: [convex] }
      )
    }

    // ── Web app ────────────────────────────────────────────────────────
    const web = new sst.aws.TanStackStart("Web", {
      path: "apps/web",
      buildCommand: "bun run build",
      environment: {
        VITE_CONVEX_URL: convexUrl,
      },
    })

    return {
      web: web.url,
      convexApi: convexUrl,
    }
  },
})
