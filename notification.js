// ============================================================================
// 🔹 Notification.js (Optimized Version)
// Sends due task notifications using tokens stored in Firestore
// ============================================================================

import { parseISO, differenceInMinutes } from "date-fns";
import admin from "firebase-admin";

const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

// 🔥 Initialize Firebase Admin once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("✅ Firebase Admin initialized");
}

const db = admin.firestore();
const fcm = admin.messaging();

// 🔔 Helper to send a push notification
async function sendNotification(token, title, body, userName) {
  try {
    await fcm.send({
      token,
      notification: { title, body },
      webpush: {
        fcmOptions: {
          link: "https://todotab-4794a.web.app/",
        },
      },
    });
    console.log(`   📩 Sent → ${userName}: ${body}`);
  } catch (err) {
    console.error(`   ❌ Failed for ${userName}: ${err.message}`);
  }
}

// ============================================================================
// 🧠 MAIN CHECK & NOTIFICATION FUNCTION
// ============================================================================
async function checkAndNotifyTasks() {
  console.log("\n⏰ Notification Summary\n");

  try {
    const usersSnap = await db.collection("users").get();
    if (usersSnap.empty) {
      console.log("⚠️ No users found.");
      return;
    }

    let totalReminders = 0;
    const now = new Date();

    // Loop through users
    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const displayName = userDoc.data().displayName || "(unknown)";
      console.log(`👤 Checking: ${displayName}`);

      // Fetch tasks (two possible locations)
      let tasks = [];

      const taskDoc = await db.collection("tasks").doc(userId).get();
      if (taskDoc.exists && Array.isArray(taskDoc.data().list)) {
        tasks = taskDoc.data().list;
      } else {
        const userTasksSnap = await db.collection("users").doc(userId).collection("tasks").get();
        tasks = userTasksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }

      if (tasks.length === 0) {
        console.log("   → No tasks.\n");
        continue;
      }

      // Fetch device tokens
      const devices = await db.collection("users").doc(userId).collection("devices").get();
      const tokens = devices.docs
        .map(d => d.data().token)
        .filter(Boolean);

      if (tokens.length === 0) {
        console.log("   → No device tokens.\n");
        continue;
      }

      // Process each task
      for (const task of tasks) {
        console.log(`\n   🧾 Task: "${task.text}"`);

        if (!task.dueDate) {
          console.log("     ⚠️ No due date");
          continue;
        }
        if (task.completed) {
          console.log("     ✔️ Completed");
          continue;
        }

        const due = parseISO(task.dueDate);
        const minsLeft = differenceInMinutes(due, now);

        const formatted = new Date(task.dueDate).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });

        console.log(`     📅 Due: ${formatted} (in ${minsLeft} min)`);

        // Reminder settings
        const rt = 15; // 15-minute reminder window
        const reminderKey = `${rt}min`;

        // --- Simplified reminder reset logic ---
        if (!task.reminders) task.reminders = {};

        const currentDue = due.toISOString();
        const prev = task.reminders[reminderKey];

        // Reset only if previous reminder was for a different due date
        if (prev?.forDueDate && prev.forDueDate !== currentDue) {
          task.reminders[reminderKey] = {};
        }

        const prevStatus = task.reminders[reminderKey]?.status || null;

        // Skip if already handled for this due date
        if (["sent", "missed", "skipped-completed"].includes(prevStatus)) {
          console.log(`     ⏭️ Already handled (${prevStatus})`);
          continue;
        }

        // Skip old overdue tasks
        if (minsLeft < -1440) continue;

        // =====================================================================
        // 🔔 15-Minute Reminder Window
        // =====================================================================
        if (minsLeft <= rt && minsLeft > rt - 15) {
          const title = "⏰ Task Reminder";
          const body = `Your task "${task.text}" is due in ${minsLeft} minutes.`;

          console.log(`     🔔 Sending reminder`);

          for (const token of tokens) {
            await sendNotification(token, title, body, displayName);
            totalReminders++;
          }

          task.reminders[reminderKey] = {
            status: "sent",
            at: new Date().toISOString(),
            forDueDate: currentDue,
          };
        }

        // =====================================================================
        // ⚠️ Missed Reminder
        // =====================================================================
        else if (minsLeft <= rt - 15) {
          if (task.completed) {
            task.reminders[reminderKey] = {
              status: "skipped-completed",
              at: new Date().toISOString(),
              forDueDate: currentDue,
            };
            continue;
          }

          const title = "⚠️ Missed Task Reminder";
          const minutesAgo = Math.abs(minsLeft);
          const body = `You missed the reminder for "${task.text}". It was due ${minutesAgo} min ago.`;

          console.log(`     ⚠️ Sending missed reminder`);

          for (const token of tokens) {
            await sendNotification(token, title, body, displayName);
            totalReminders++;
          }

          task.reminders[reminderKey] = {
            status: "missed",
            at: new Date().toISOString(),
            forDueDate: currentDue,
          };
        }
      }

      // Save updated tasks
      await db.collection("tasks").doc(userId).set({ list: tasks }, { merge: true });
      console.log("");
    }

    console.log(`\n🎉 Done! Total reminders sent: ${totalReminders}\n`);
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

// 🚀 Run
checkAndNotifyTasks().then(() => process.exit());
