import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

// Must match electron-builder.config.ts, which ships ai.mindscript.studio*
const appId = channel === "prod" ? "ai.mindscript.studio" : `ai.mindscript.studio.${channel}`
const productName = channel === "prod" ? "MindScript Studio" : `MindScript Studio ${channel.charAt(0).toUpperCase() + channel.slice(1)}`
const summary = `Open source AI coding agent${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="ly.anoma">
    <name>MindScript</name>
  </developer>

  <description>
    <p>
      MindScript Studio is a coding agent that routes each task to whichever AI model will do it best for the least money.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/MST-betterAI/mindscript-studio/issues</url>
  <url type="homepage">https://github.com/MST-betterAI/mindscript-studio</url>
  <url type="vcs-browser">https://github.com/MST-betterAI/mindscript-studio</url>

</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
