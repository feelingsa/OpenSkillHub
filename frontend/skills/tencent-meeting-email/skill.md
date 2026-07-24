---
name: tencent-meeting-email
description: Create a Tencent Meeting from a natural-language Chinese chat message, then email the meeting link. Use when the user asks to book/schedule a Tencent Meeting and send the invitation by email using this self-contained skill plus the installed tencent-meeting-mcp skill.
metadata:
  requires:
    env:
      - TENCENT_MEETING_TOKEN
      - MAIL236_PASSWORD
    files:
      - scripts/mail.py
      - receiver_email.json
      - C:\Users\zyx\.codex\skills\tencent-meeting-mcp
---

# Tencent Meeting Email

Use this skill to book a Tencent Meeting from one Chinese chat sentence and send the meeting details by email.

## Workflow

1. Run this skill's `scripts/mail.py` `parse_meeting_info(chat_text)` to extract:
   - `time`, such as `明天上午10:30`
   - `location`, such as `第二会议室`
2. Convert the parsed time to China time, using a 60-minute meeting duration unless the user specifies otherwise.
3. Call the installed `tencent-meeting-mcp` skill's MCP endpoint with `schedule_meeting`.
4. Extract Tencent Meeting `join_url`, `meeting_code`, `meeting_id`, `start_time`, and `end_time`.
5. Load this skill's `receiver_email.json`, read `MAIL236_PASSWORD`, and call `send_weekly_meeting_email(...)` from `scripts/mail.py`.

## Script

From the folder that contains this skill:

```powershell
python .\tencent-meeting-email\scripts\book_and_email.py "我订了第二会议室，明天上午十点半，名字叫TPS组会"
```

After installing as a global skill, the script can also be run by absolute path:

```powershell
python "$HOME\.codex\skills\tencent-meeting-email\scripts\book_and_email.py" "我订了第二会议室，明天上午十点半，名字叫TPS组会"
```

Optional arguments:

```powershell
python .\tencent-meeting-email\scripts\book_and_email.py "<chat text>" --subject "TPS组会" --duration-minutes 60
```

Dry run without creating a meeting or sending mail:

```powershell
python .\tencent-meeting-email\scripts\book_and_email.py "<chat text>" --dry-run
```

If `TENCENT_MEETING_TOKEN` is not visible in the current process, set it before running the script. If `MAIL236_PASSWORD` is missing, the script stops before sending mail.

## Notes

- Meeting title priority: `--subject`, then text patterns like `名字叫TPS组会`, then default `TPS组会`.
- Email location uses the physical room parsed from the chat message, not the Tencent Meeting URL.
- Email meeting link uses the `join_url` returned by Tencent Meeting MCP.
