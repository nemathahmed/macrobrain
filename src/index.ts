import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { answerFoodQuery } from "./agent.ts";
import { getOrCreateUser } from "./user.ts";
import { migrate } from "./db.ts";
import { getBusinessPhoneIndex, handleBusinessText, seedBusinesses } from "./business.ts";

await migrate();
await seedBusinesses();

const app = await Spectrum({
  projectId: process.env.PHOTON_PROJECT_ID!,
  projectSecret: process.env.PHOTON_SECRET_KEY!,
  providers: [imessage.config()],
});

const businessIndex = getBusinessPhoneIndex();

console.log(`macrobrain running on ${process.env.PHOTON_NUMBER}`);
console.log(`${businessIndex.size} restaurant phones indexed`);

for await (const [space, message] of app.messages) {
  if (message.content.type !== "text") continue;

  const phone = message.sender.id;
  const text = message.content.text.trim();

  const restaurant = businessIndex.get(phone);

  if (restaurant) {
    // Inbound from a known restaurant — treat as deal update
    try {
      const reply = await handleBusinessText(phone, text, restaurant);
      await space.send(reply);
    } catch (err) {
      console.error(`Error handling business text from ${phone}:`, err);
      await space.send("Got your message! We'll add it to macrobrain shortly.");
    }
  } else {
    // Regular user query
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
}
