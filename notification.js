// ============================================================================
// 🔹 notification.js
// Sends notifications using tokens from /users/{uid}/devices/{deviceId}/token
// ============================================================================

import { parseISO, differenceInMinutes } from "date-fns";
import admin from "firebase-admin";
const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);


// ✅ Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("✅ Firebase Admin initialized successfully.");
}

const db = admin.firestore();
const fcm = admin.messaging();

// 🔔 Helper: Send notification
async function sendNotification(token, title, body, userName) {
  try {
    await fcm.send({
      token,
      notification: { title, body },
      webpush: {
    fcmOptions: {
      link: "https://todotab-4794a.web.app/", // 👈 this makes it clickable
    },
  },
    });
    console.log(`✅ Sent to ${userName}: ${body}`);
  } catch (err) {
    console.error(`❌ FCM send failed for ${userName}: ${err.message}`);
  }
}

// 🧠 Main function: check due tasks & send reminders
async function checkAndNotifyTasks() {
  console.log("⏰ Checking tasks due soon and sending notifications...\n");

  try {
    const usersSnap = await db.collection("users").get();
    if (usersSnap.empty) {
      console.log("⚠️ No users found.");
      return;
    }

    const now = new Date();
    let totalReminders = 0;

    // Loop over all users
    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      const displayName = userData.displayName || "(unknown)";
      console.log(`👤 Checking user: ${displayName} (${userId})`);

      // Fetch tasks
      const taskDoc = await db.collection("tasks").doc(userId).get();
      if (!taskDoc.exists) {
        console.log("  → No task document found.\n");
        continue;
      }

      const taskData = taskDoc.data();
      const tasks = taskData.list || [];

      if (!Array.isArray(tasks) || tasks.length === 0) {
        console.log("  → No tasks found.\n");
        continue;
      }

      // Fetch FCM tokens under /users/{uid}/devices
      const devicesSnap = await db.collection("users").doc(userId).collection("devices").get();
      const tokens = [];

      devicesSnap.forEach((doc) => {
        const data = doc.data();
        if (data?.token && !tokens.includes(data.token)) {
          tokens.push(data.token);
        }
      });

      if (tokens.length === 0) {
        console.log("  → No FCM tokens found.\n");
        continue;
      }

      console.log(`  → Found ${tokens.length} device token(s).`);

      // Loop through each task
      for (const task of tasks) {
        if (!task.dueDate || task.completed) continue;

        const due = parseISO(task.dueDate);
        const minsLeft = differenceInMinutes(due, now);

        const remindTimes = [30, 15]; // minutes before due time
        for (const rt of remindTimes) {
            if (minsLeft === rt && !(task.reminders?.[`${rt}min`] ?? false)) {
              const title = "⏰ Task Reminder";
              const body = `Your task "${task.text}" is due in ${minsLeft} minutes.`;

              console.log(`   🔔 ${displayName} — "${task.text}" (${minsLeft} mins left)`);

              for (const token of tokens) {
                await sendNotification(token, title, body, displayName);
                totalReminders++;
              }

              // ✅ Mark this reminder as sent
              if (!task.reminders) task.reminders = {};
              task.reminders[`${rt}min`] = true;
            }
          }
      }
      // After processing all tasks, update Firestore
      await db.collection("tasks").doc(userId).set({ list: tasks }, { merge: true });
      console.log(""); // spacing
    }

    console.log(`✅ Done! Total reminders sent: ${totalReminders}\n`);
  } catch (err) {
    console.error("❌ Error checking tasks:", err);
  }
}

// 🚀 Run
checkAndNotifyTasks().then(() => process.exit());



