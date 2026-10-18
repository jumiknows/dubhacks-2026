# Three-minute demo

Use a verified historical observation window for the rehearsed story. Demonstrate the live connector separately and label both modes clearly.

## 0:00 to 0:20: Human problem

"A community volunteer can find a wildfire map. Understanding when the satellite last observed an area, what changed, and how to explain it to someone who cannot use the map is harder. EmberReady connects satellite evidence to an accessible briefing."

Show the actual app immediately. Do not spend the opening on architecture slides.

## 0:20 to 0:55: Space data

Select a community in the verified replay region. Show NASA source, acquisition time, and dataset provenance. Open one observation in the evidence panel.

Explain that a thermal observation is not a confirmed incident or a fire perimeter.

## 0:55 to 1:25: Change over time

Move the timeline. The observation layer, list, and context change together. Point out the newly observed points and their acquisition times.

Say "new observations" rather than "the fire started here" or "this predicts spread."

## 1:25 to 2:05: Grok Voice

Ask: "What changed near this community, and how old is the evidence?"

Grok should use the selected place context, explain the result, and expose the same transcript and sources. Move the timeline or change the place and demonstrate that an old response is canceled.

Use one language confidently. Show a second only if its names, dates, units, and meaning were checked.

## 2:05 to 2:30: Access and resilience

Switch to the keyboard-accessible list and show the copy or print briefing. Demonstrate a labeled unavailable-data state or cached replay if rehearsed. Do not simulate an outage while claiming it is an observed live failure.

## 2:30 to 3:00: Evidence and close

Show real Cursor implementation evidence and one genuine Grok API result without exposing secrets. Mention observed usability results only if the sessions actually happened.

"The next step is a pilot with a community organization to test whether this helps people understand and communicate the evidence."

## Freeze rule

Reserve the final 20 percent of the remaining time for integration and rehearsal. Cut terrain, imagery comparison, and extra languages before cutting the working map-to-briefing flow. Keep a clearly labeled recording of a successful run as backup.

## Questions to prepare for

| Judge question | Honest answer to demonstrate |
| --- | --- |
| Is this early detection? | It surfaces available satellite observations. We have not measured a detection lead-time advantage. |
| What is the AI doing? | A real Grok Voice session explains the selected, computed context through a constrained tool. |
| Is the color a probability? | No. It is an explained observation-proximity band. |
| What if data is missing? | The UI shows unknown, unavailable, or stale state and keeps official links visible. |
| What is new? | Our hypothesis is accessible source-grounded community briefings with synchronized replay. Existing map products already cover many alerting needs. |
| Is it ready for public safety use? | It is a hackathon awareness prototype. A real deployment requires validation and an operational owner. |
