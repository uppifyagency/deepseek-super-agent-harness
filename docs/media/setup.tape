# harness setup on an empty test home, then harness doctor. Run through docs/media/record.sh.
Output docs/media/setup.gif

Set Shell bash
Set FontSize 14
Set Width 1180
Set Height 600
Set Padding 24
Set Framerate 12
Set TypingSpeed 18ms
Set Theme { "name": "blueprint", "background": "#0a1330", "foreground": "#d8e2f3", "cursor": "#4cc3f5", "selection": "#16295a", "black": "#0f1f47", "red": "#ff6b6b", "green": "#4fd69c", "yellow": "#ffad42", "blue": "#4cc3f5", "magenta": "#c3a6ff", "cyan": "#86abdf", "white": "#d8e2f3", "brightBlack": "#3d5d99", "brightRed": "#ff8f8f", "brightGreen": "#7ee6b8", "brightYellow": "#ffc87a", "brightBlue": "#86d4f8", "brightMagenta": "#d9c6ff", "brightCyan": "#a9c4ea", "brightWhite": "#f3f7ff" }

Hide
Type "export PS1='$ ' PS2='  ' HISTFILE=/dev/null; alias harness='node /tmp/sah-gif/repo/harness/src/cli.ts'; clear"
Enter
Show

Type "echo $HARNESS_HOME; ls -A $HARNESS_HOME | wc -l"
Enter
Sleep 1.2s
Type "printf 'not_a_real_token\n' | harness setup --yes \"
Enter
Type "--repo uppifyagency/harness-sandbox --allow uppifyagency --handle /harness-gif \"
Enter
Type "--label it.delera.harness.gif --keychain harness-bot-github-test-gif \"
Enter
Type "--pstack /tmp/sah-gif/pstack-claude/plugins/pstack"
Enter
Wait@60s /^\$\s*$/
Sleep 2s
Type "clear; harness doctor; echo exit $?"
Enter
Wait+Screen@30s /exit 0/
Sleep 4s
