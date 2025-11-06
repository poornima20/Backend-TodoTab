// ============================================================================
// 🔹 Notification.js
// Sends notifications using tokens from /users/{uid}/devices/{deviceId}/token
// ============================================================================

import { parseISO, differenceInMinutes } from "date-fns";
import admin from "firebase-admin";

const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT); // for GitHub Actions
// import serviceAccount from "./service-account.json" with { type: "json" };

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
          link: "https://todotab-4794a.web.app/", // 👈 clickable link
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
  console.log("⏰ Notification Summary\n");

  try {
    const usersSnap = await db.collection("users").get();
    if (usersSnap.empty) {
      console.log("⚠️ No users found.");
      return;
    }

    const now = new Date();
    let totalReminders = 0;

    // Loop through all users
    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      const displayName = userData.displayName || "(unknown)";
      console.log(`👤 Checking user: ${displayName}`);

      // 🔹 Try fetching tasks from /tasks/{uid}
      const taskDoc = await db.collection("tasks").doc(userId).get();
      let tasks = [];

      if (taskDoc.exists) {
        const taskData = taskDoc.data();
        if (Array.isArray(taskData.list)) {
          tasks = taskData.list;
          console.log(`  🧮 Found ${tasks.length} tasks.`);
        } else {
          console.log(`  ⚠️ No valid 'list' array found in /tasks/${userId}`);
        }
      } else {
        console.log(`  🚫 No /tasks/${userId} document found.`);
      }

      // 🧩 Fallback: If nothing found, check under /users/{uid}/tasks
      if (tasks.length === 0) {
        const userTasksSnap = await db.collection("users").doc(userId).collection("tasks").get();
        if (!userTasksSnap.empty) {
          tasks = userTasksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          console.log(`  🔄 Found ${tasks.length} tasks in /users/${userId}/tasks`);
        }
      }

      if (tasks.length === 0) {
        console.log("  → No tasks found for this user.\n");
        continue;
      }

      // 🔹 Fetch FCM tokens
      const devicesSnap = await db.collection("users").doc(userId).collection("devices").get();
      const tokens = [];

      devicesSnap.forEach(doc => {
        const data = doc.data();
        if (data?.token && !tokens.includes(data.token)) tokens.push(data.token);
      });

      if (tokens.length === 0) {
        console.log("  → No FCM tokens found.\n");
        continue;
      }

      console.log(`  → Found ${tokens.length} device token(s).`);

      // 🔁 Loop through each task
      for (const task of tasks) {
        process.stdout.write(`   🧾 Task: "${task.text}"`);

        if (!task.dueDate) {
          console.log(" ⚠️ No due date set");
          continue;
        }
        if (task.completed) {
          console.log(" ✅ Task completed");
          continue;
        }

        const due = parseISO(task.dueDate);
        const minsLeft = differenceInMinutes(due, now);

        const formattedDate = new Date(task.dueDate).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });

        console.log(`\n 📅 Due Date: ${formattedDate} (in ${minsLeft} minutes)`);

        const rt = 15; // single reminder interval
        const reminderKey = `${rt}min`;

        if (!task.reminders) task.reminders = {};

        // Get previous reminder status
        const prev = task.reminders[reminderKey];
        const prevStatus = typeof prev === "object" ? prev.status : (prev ? "sent" : null);

        // 🧠 Skip if already handled
        if (["sent", "missed", "skipped-completed"].includes(prevStatus)) {
          console.log(`   ⏭️ Already handled (${prevStatus}) for "${task.text}"`);
          continue;
        }

        // Skip very old overdue tasks (>24h)
        if (minsLeft < -1440) continue;

        // 🔹 Case 1: Regular 15-min reminder (within window)
        if (minsLeft <= rt && minsLeft > rt - 15) {
          const title = "⏰ Task Reminder";
          const body = `Your task "${task.text}" is due in ${minsLeft} minutes.`;
          console.log(`   🔔 ${displayName} — ${body}`);

          for (const token of tokens) {
            await sendNotification(token, title, body, displayName);
            totalReminders++;
          }

          task.reminders[reminderKey] = { status: "sent", at: new Date().toISOString() };
        }

        // ⚠️ Case 2: Missed reminder (past due, never sent)
        else if (minsLeft <= rt - 15) {
          if (task.completed) {
            task.reminders[reminderKey] = { status: "skipped-completed", at: new Date().toISOString() };
            continue;
          }

          const title = "⚠️ Missed Task Reminder";
          const minutesAgo = Math.abs(minsLeft);
          const whenText = minsLeft < 0
            ? `${minutesAgo} minute(s) ago`
            : `within the last ${rt} minutes`;
          const body = `You missed a reminder for "${task.text}". It was due ${whenText}.`;

          console.log(`   ⚠️ ${displayName} — ${body}`);

          for (const token of tokens) {
            await sendNotification(token, title, body, displayName);
            totalReminders++;
          }

          // 🔒 Mark permanently as missed (never repeat)
          task.reminders[reminderKey] = { status: "missed", at: new Date().toISOString() };
        }

        console.log(""); // spacing for clarity
      }

      // ✅ Update Firestore after all tasks processed
      await db.collection("tasks").doc(userId).set({ list: tasks }, { merge: true });
      console.log("");
    }

    console.log(`✅ Done! Total reminders sent: ${totalReminders}\n`);
  } catch (err) {
    console.error("❌ Error checking tasks:", err);
  }
}

// 🚀 Run
checkAndNotifyTasks().then(() => process.exit());
