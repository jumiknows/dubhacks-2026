# T-Mobile track

Two problems are worth building for. People get stuck moving a number to a new plan, and they get stuck on the phone with support because the agent cannot see what the app already knows.

## Porting a number

Switching providers is mostly a waiting game with a bad error message. The number leaves one carrier only after the new one accepts a port. Until then the phone can sit with no service, or with service on the old SIM and data on the new one.

What usually goes wrong:

- The account number, PIN, or billing zip on the port request does not match the old carrier. The port is rejected and the user is told "contact your previous carrier" with no field-level reason.
- The line is still on a device payment plan, a family account, or a business account, so the old carrier will not release it.
- The user starts the port, then the old SIM dies before the new one is active. Calls and texts vanish for hours.
- A prepaid line uses a different account number than the one printed on the bill.
- The port is submitted twice. The second request cancels or delays the first.
- eSIM makes this sharper. The phone can install a new eSIM while the physical SIM is still the line that owns the number. If the port fails, the user now has two plans on the phone and no idea which one can place a call.
- Some phones allow only one active eSIM for voice. Switching the active line drops the number they were trying to keep.
- International travel adds a travel eSIM on top. The port and the travel line fight over which SIM is default for iMessage, SMS, and cellular data.

What the app can do:

- Ask for the old account number, transfer PIN, and billing zip before the port is sent, and say which field the old carrier rejected.
- Show a single status: not started, submitted, rejected, scheduled, done. Keep the rejection text, not a generic failure.
- Warn before the port if the line still has a device balance or is not the account owner.
- For eSIM, show which line is active for calls, texts, and data, and do not switch the active voice line until the port is marked done.
- Keep the old SIM instructions on screen until the number actually rings on the new plan. "Turn on the new eSIM" is the wrong first step if the port is still pending.
- Let the user save the port reference number so a support call does not start from zero.

## Support that can see the app

A support call fails when the person, or the agent, has to ask for information the app already has: which line, which device, whether a port is in flight, what the last rejection said, which eSIM is active.

An agent inside the app should answer from that record instead of opening a blank chat.

- The agent can read the lines on the account, the active SIM or eSIM, the device name, and the current port status.
- If a port was rejected, the agent starts from the rejection reason and the fields that were sent. It does not ask the user to remember the account PIN.
- If the user says calls fail, the agent checks which line is set for voice before it suggests a new eSIM.
- The agent can draft the next step, such as "request a new transfer PIN from the old carrier," and file that on the port. It should not submit a second port on its own.
- When the question needs a person, the handoff includes the same record: line, device, port id, last error, and what the agent already tried.
- The agent does not invent coverage, billing, or a port date. If the app does not have the fact, it says so.

Camping and wedding widgets are out of this track. The phone plan lives next to the electronics board only if a later pass adds it. For now the work is the port record and the agent that can use it.
