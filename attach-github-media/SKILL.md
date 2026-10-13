---
name: attach-github-media
description: Upload a local image or video onto a GitHub pull request or issue so it renders inline, using `gh --attach`. Use when the user asks to attach, upload, or add a screenshot, screen recording, preview, or walkthrough to a PR description, PR comment, or issue, including "compress and attach" and replacing a preview that is already on the PR. Also use when they ask how a user-attachments video was posted.
---

# Attach GitHub media

Upload a local image or video with GitHub CLI so GitHub hosts it and the Markdown points at that URL. Do not commit the file to the repo.

Requires `gh` 2.99 or newer (`gh --version`) and write access to the repo. Supported files: png, jpg, jpeg, gif, webp, svg, mp4, mov, webm. Images and gifs cap at 10 MB. Video caps at 10 MB on Free and 100 MB on paid plans.

## Prepare a screen recording

macOS screen recordings are often retina-sized and named with a narrow no-break space (`U+202F`) before `AM`/`PM`. Resolve the path with a glob. Do not type the filename by hand.

Compress to an mp4 before uploading. 1440 px wide keeps context-menu text readable and stays far under the size cap:

```shell
ffmpeg -y -i "$SRC" \
  -vf "scale=1440:-2" \
  -c:v libx264 -crf 28 -preset slow \
  -pix_fmt yuv420p -movflags +faststart \
  -an /tmp/preview.mp4
```

Spot-check a few frames. A recording that never shows the menu, or that shows the wrong clip, should not be uploaded.

## Place the file in the body

Fetch the current body first (`gh pr view NUMBER --json body --jq .body`, or the issue equivalent). Edit that text. `--body` and `--body-file` replace the whole body, so dropping the fetched text loses the description.

A video renders as a player only when its reference is the only content in its paragraph. Write it as an image reference with an empty alt:

```markdown
## Preview

![](/tmp/preview.mp4)
```

The path must be the same string passed to `--attach`. A reference inside a sentence becomes a link, not a player.

An image can keep alt text: `![the sign-in error](./login.png)`.

## Upload

`gh pr edit` with no number uses the pull request for the current branch. Repeat `--attach` for more files, up to 50. Do not attach the same file twice.

```shell
gh pr edit 3359 \
  --body-file /tmp/pr-body.md \
  --attach /tmp/preview.mp4
```

`gh` uploads the file and rewrites each matching `![](path)` or `![alt](path)` to the hosted URL. A video's reference becomes a bare `https://github.com/user-attachments/assets/...` line. An image stays an image embed. Anything attached that the body does not mention is appended at the end.

Without `--body` or `--body-file`, the existing body is kept and every attachment is appended. Use that only when the end of the body is the right place.

The same `--attach` flag works on `gh pr comment`, `gh issue create`, `gh issue edit`, and `gh issue comment`.

Image alt text can also be set on the flag: `--attach './login.png#The login error'`. A reference already in the body keeps the alt text written there. Video has no alt text. Passing `#...` on a video is refused.

## Replace a preview already on the PR

Find the old `https://github.com/user-attachments/assets/...` line. Replace that line with `![](/tmp/new-preview.mp4)` on its own paragraph, then run `gh pr edit` with both `--body-file` and `--attach`. That swaps the player in place. `--attach` alone appends a second player and leaves the old one.

## Check

Read the body back and confirm:

- one new `user-attachments` URL, and the local path is gone
- a video URL is alone in its paragraph
- the previous preview URL is gone when this was a replacement
- the rest of the description is unchanged
