# Replays the terminal output captured during the live A3 proof (issue #69 to PR #78, 2 Nov 2026).
# Nothing is generated: each command prints a line range of design/mvp/e2e/a3/logs/a3-trunk-vs-head.txt.
Output docs/media/ticket.gif

Set Shell bash
Set FontSize 14
Set Width 1180
Set Height 640
Set Padding 24
Set Framerate 12
Set TypingSpeed 18ms
Set Theme { "name": "blueprint", "background": "#0a1330", "foreground": "#d8e2f3", "cursor": "#4cc3f5", "selection": "#16295a", "black": "#0f1f47", "red": "#ff6b6b", "green": "#4fd69c", "yellow": "#ffad42", "blue": "#4cc3f5", "magenta": "#c3a6ff", "cyan": "#86abdf", "white": "#d8e2f3", "brightBlack": "#3d5d99", "brightRed": "#ff8f8f", "brightGreen": "#7ee6b8", "brightYellow": "#ffc87a", "brightBlue": "#86d4f8", "brightMagenta": "#d9c6ff", "brightCyan": "#a9c4ea", "brightWhite": "#f3f7ff" }

Hide
Type `export PS1='$ ' HISTFILE=/dev/null; replay() { sed -n "$1,$2p" design/mvp/e2e/a3/logs/a3-trunk-vs-head.txt | cut -c1-122; }; clear`
Enter
Show

Type "# replay of a real run, captured in design/mvp/e2e/a3/logs/a3-trunk-vs-head.txt"
Enter
Sleep 1s
Type "replay 24 35"
Enter
Sleep 5s
Type "replay 36 45"
Enter
Sleep 5s
Type "clear; replay 46 53"
Enter
Sleep 5s
