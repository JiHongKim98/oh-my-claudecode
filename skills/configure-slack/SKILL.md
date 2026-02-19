---
name: configure-slack
description: Configure Slack incoming webhook notifications via natural language
triggers:
  - "configure slack"
  - "setup slack"
  - "slack notifications"
  - "slack webhook"
---

# Configure Slack Notifications

Set up Slack notifications so OMC can message you when sessions end, need input, or complete background tasks.

## How This Skill Works

This is an interactive, natural-language configuration skill. Walk the user through setup by asking questions with AskUserQuestion. Write the result to `~/.claude/.omc-config.json`.

## Step 1: Detect Existing Configuration

```bash
CONFIG_FILE="$HOME/.claude/.omc-config.json"

if [ -f "$CONFIG_FILE" ]; then
  HAS_SLACK=$(jq -r '.notifications.slack.enabled // false' "$CONFIG_FILE" 2>/dev/null)
  WEBHOOK_URL=$(jq -r '.notifications.slack.webhookUrl // empty' "$CONFIG_FILE" 2>/dev/null)
  MENTION=$(jq -r '.notifications.slack.mention // empty' "$CONFIG_FILE" 2>/dev/null)
  CHANNEL=$(jq -r '.notifications.slack.channel // empty' "$CONFIG_FILE" 2>/dev/null)

  if [ "$HAS_SLACK" = "true" ]; then
    echo "EXISTING_CONFIG=true"
    [ -n "$WEBHOOK_URL" ] && echo "WEBHOOK_URL=$WEBHOOK_URL"
    [ -n "$MENTION" ] && echo "MENTION=$MENTION"
    [ -n "$CHANNEL" ] && echo "CHANNEL=$CHANNEL"
  else
    echo "EXISTING_CONFIG=false"
  fi
else
  echo "NO_CONFIG_FILE"
fi
```

If existing config is found, show the user what's currently configured and ask if they want to update or reconfigure.

## Step 2: Create a Slack Incoming Webhook

Guide the user through creating a webhook if they don't have one:

```
To set up Slack notifications, you need a Slack incoming webhook URL.

CREATE A WEBHOOK:
1. Go to https://api.slack.com/apps
2. Click "Create New App" > "From scratch"
3. Name your app (e.g., "OMC Notifier") and select your workspace
4. Go to "Incoming Webhooks" in the left sidebar
5. Toggle "Activate Incoming Webhooks" to ON
6. Click "Add New Webhook to Workspace"
7. Select the channel where notifications should be posted
8. Copy the webhook URL (starts with https://hooks.slack.com/services/...)
```

## Step 3: Collect Webhook URL

Use AskUserQuestion:

**Question:** "Paste your Slack incoming webhook URL (starts with https://hooks.slack.com/services/...)"

The user will type their webhook URL in the "Other" field.

**Validate** the URL:
- Must start with `https://hooks.slack.com/services/`
- If invalid, explain the format and ask again

## Step 4: Configure Mention (User/Group Ping)

Use AskUserQuestion:

**Question:** "Would you like notifications to mention (ping) someone?"

**Options:**
1. **Yes, mention a user** - Tag a specific user by their Slack member ID
2. **Yes, mention a channel** - Use @channel to notify everyone in the channel
3. **Yes, mention @here** - Notify only active members in the channel
4. **No mentions** - Just post the message without pinging anyone

### If user wants to mention a user:

Ask: "What is the Slack member ID to mention? (Click on a user's profile > More (⋯) > Copy member ID)"

The mention format is: `<@MEMBER_ID>` (e.g., `<@U1234567890>`)

### If user wants @channel:

The mention format is: `<!channel>`

### If user wants @here:

The mention format is: `<!here>`

## Step 5: Configure Events

Use AskUserQuestion with multiSelect:

**Question:** "Which events should trigger Slack notifications?"

**Options (multiSelect: true):**
1. **Session end (Recommended)** - When a Claude session finishes
2. **Input needed** - When Claude is waiting for your response (great for long-running tasks)
3. **Session start** - When a new session begins
4. **Session continuing** - When a persistent mode keeps the session alive

Default selection: session-end + ask-user-question.

## Step 6: Optional Channel Override

Use AskUserQuestion:

**Question:** "Override the default notification channel? (The webhook already has a default channel)"

**Options:**
1. **Use webhook default (Recommended)** - Post to the channel selected during webhook setup
2. **Override channel** - Specify a different channel (e.g., #alerts)

If override, ask for the channel name (e.g., `#alerts`).

## Step 7: Optional Username Override

Use AskUserQuestion:

**Question:** "Custom bot display name? (Shows as the webhook sender name in Slack)"

**Options:**
1. **OMC (default)** - Display as "OMC"
2. **Claude Code** - Display as "Claude Code"
3. **Custom** - Enter a custom name

## Step 8: Write Configuration

Read the existing config, merge the new Slack settings, and write back:

```bash
CONFIG_FILE="$HOME/.claude/.omc-config.json"
mkdir -p "$(dirname "$CONFIG_FILE")"

if [ -f "$CONFIG_FILE" ]; then
  EXISTING=$(cat "$CONFIG_FILE")
else
  EXISTING='{}'
fi

# WEBHOOK_URL, MENTION, USERNAME, CHANNEL are collected from user
echo "$EXISTING" | jq \
  --arg url "$WEBHOOK_URL" \
  --arg mention "$MENTION" \
  --arg username "$USERNAME" \
  --arg channel "$CHANNEL" \
  '.notifications = (.notifications // {enabled: true}) |
   .notifications.enabled = true |
   .notifications.slack = {
     enabled: true,
     webhookUrl: $url,
     mention: (if $mention == "" then null else $mention end),
     username: (if $username == "" then null else $username end),
     channel: (if $channel == "" then null else $channel end)
   }' > "$CONFIG_FILE"
```

### Add event-specific config if user didn't select all events:

For each event NOT selected, disable it:

```bash
# Example: disable session-start if not selected
echo "$(cat "$CONFIG_FILE")" | jq \
  '.notifications.events = (.notifications.events // {}) |
   .notifications.events["session-start"] = {enabled: false}' > "$CONFIG_FILE"
```

## Step 9: Test the Configuration

After writing config, offer to send a test notification:

Use AskUserQuestion:

**Question:** "Send a test notification to verify the setup?"

**Options:**
1. **Yes, test now (Recommended)** - Send a test message to your Slack channel
2. **No, I'll test later** - Skip testing

### If testing:

```bash
# For webhook:
MENTION_PREFIX=""
if [ -n "$MENTION" ]; then
  MENTION_PREFIX="${MENTION}\n"
fi

curl -s -o /dev/null -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"${MENTION_PREFIX}OMC test notification - Slack is configured!\"}" \
  "$WEBHOOK_URL"
```

Report success or failure. Common issues:
- **403 Forbidden**: Webhook URL is invalid or revoked
- **404 Not Found**: Webhook URL is incorrect
- **channel_not_found**: Channel override is invalid
- **Network error**: Check connectivity to hooks.slack.com

## Step 10: Confirm

Display the final configuration summary:

```
Slack Notifications Configured!

  Webhook:  https://hooks.slack.com/services/T00/B00/xxx...
  Mention:  <@U1234567890> (or "none")
  Channel:  #alerts (or "webhook default")
  Events:   session-end, ask-user-question
  Username: OMC

Config saved to: ~/.claude/.omc-config.json

You can also set these via environment variables:
  OMC_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
  OMC_SLACK_MENTION=<@U1234567890>

To reconfigure: /oh-my-claudecode:configure-slack
To configure Discord: /oh-my-claudecode:configure-discord
To configure Telegram: /oh-my-claudecode:configure-telegram
```

## Environment Variable Alternative

Users can skip this wizard entirely by setting env vars in their shell profile:

```bash
export OMC_SLACK_WEBHOOK_URL="https://hooks.slack.com/services/T00/B00/xxx"
export OMC_SLACK_MENTION="<@U1234567890>"  # optional
```

Env vars are auto-detected by the notification system without needing `.omc-config.json`.

## Slack Mention Formats

| Type | Format | Example |
|------|--------|---------|
| User | `<@MEMBER_ID>` | `<@U1234567890>` |
| Channel | `<!channel>` | `<!channel>` |
| Here | `<!here>` | `<!here>` |
| Everyone | `<!everyone>` | `<!everyone>` |
| User Group | `<!subteam^GROUP_ID>` | `<!subteam^S1234567890>` |
