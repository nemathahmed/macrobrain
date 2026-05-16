import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { answerFoodQuery } from "./agent.ts";
import { getOrCreateUser } from "./user.ts";

const app = await Spectrum({
  projectId: process.env.PHOTON_PROJECT_ID!,
  projectSecret: process.env.PHOTON_SECRET_KEY!,
  providers: [imessage.config()],
});

console.log(`macrobrain running on ${process.env.PHOTON_NUMBER}`);

for await (const [space, message] of app.messages) {
  if (message.content.type !== "text") continue;

  const phone = message.sender.id;
  const text = message.content.text.trim();

  try {
    const user = await getOrCreateUser(phone);

    await space.responding(async () => {
      const reply = await answerFoodQuery(text, user, phone);
      await space.send(reply);
    });
  } catch (err) {
    console.error(`Error handling message from ${phone}:`, err);
    await space.send("Sorry, something went wrong. Try again in a moment.");
  }
}
