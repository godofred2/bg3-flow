# Prompt for the testing session

Paste everything below the line into a Claude session that can reach the Foundry server (browser access to the Foundry UI is enough). Fill in the two placeholders first.

---

You are testing a Foundry VTT module I wrote, **BG3 Flow** (https://github.com/godofred2/bg3-flow). Another Claude session wrote it and will fix whatever you find, so your job is only to run the checks and report. Do not edit the module.

Server: FOUNDRY_URL_HERE
GM login: GM_USER_HERE (I will type the password when you ask)

Test script: https://raw.githubusercontent.com/godofred2/bg3-flow/main/docs/SERVER-TESTING.md
Read it first, then follow it top to bottom.

What is already done: Foundry 14, dnd5e 6.0.x and Midi QOL 14.6+ are updated and BG3 Flow is installed. So in section 0 only confirm the versions on the setup screen and write them down.

Rules:
1. Do the checks in order, C1 to C16. Record pass or fail for each one with a one-line note.
2. If a check needs the player side (C7, C8, C9, C14c), open a second browser tab or an incognito window logged in as Player1.
3. Keep the browser developer console open (F12). Copy every line that contains `[bg3-flow]` and every red error.
4. If something blocks you (a dialog you cannot close, a missing compendium item), note it, skip that check, and keep going with the next one.
5. Never change files in the module folder and never edit scripts. Changing Foundry settings, actors, scenes and items in the scratch world is fine.
6. If you cannot get into the server at all, stop and tell me instead of trying alternatives.

When you finish, answer with the report in exactly the template at the end of the test script, nothing else. I will paste it back to the other session.
