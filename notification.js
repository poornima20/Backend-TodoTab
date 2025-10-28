// ============================================================================
// 🔹 Notification.js
// Sends notifications using tokens from /users/{uid}/devices/{deviceId}/token
// ============================================================================

import { parseISO, differenceInMinutes } from "date-fns";
import admin from "firebase-admin";
const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT); // for GitHub Actions
//import serviceAccount from "./service-account.json" with { type: "json" };  



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
  console.log("⏰ Notification Summary\n");

  try {
      const usersSnap = await db.collection("users").get();
      if (usersSnap.empty) { console.log("⚠️ No users found."); return; }

      const now = new Date();
      let totalReminders = 0;

      // Loop over all users
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
           console.log(`  🧮 Found ${tasks.length} tasks .`);
        } else {
        console.log(`  ⚠️ No valid 'list' array found in /tasks/${userId}`);
        }
      } 
      else {
        console.log(`  🚫 No /tasks/${userId} document found.`);
      }

      // 🧩 Fallback: If nothing found, check if data is under /users/{uid}/tasks
      if (tasks.length === 0) {
        const userTasksSnap = await db.collection("users").doc(userId).collection("tasks").get();
        if (!userTasksSnap.empty) {
        tasks = userTasksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          console.log(`  🔄 Found ${tasks.length} tasks in /users/${userId}/tasks`);
        }
      }

// ✅ Continue only if we have tasks
      if (tasks.length === 0) {
        console.log("  → No tasks found for this user.\n");
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
      process.stdout.write(`   🧾 Task: "${task.text}"`);
  
      if (!task.dueDate) { console.log(" ⚠️ No due date set");  continue;  }
        if (task.completed) {  console.log(" ✅ Task completed");  continue;  }

      const due = parseISO(task.dueDate);
      const minsLeft = differenceInMinutes(due, now);
      console.log(`\n 📅 Due Date: ${task.dueDate} (in ${minsLeft} minutes)`);

      const remindTimes = [15]; // reminder intervals in minutes

      for (const rt of remindTimes) {
      // 🔹 Allow a small range instead of exact match
      // e.g. 25–30 mins or 10–15 mins before due
      if (minsLeft <= rt && minsLeft > rt - 15 && !(task.reminders?.[`${rt}min`] ?? false)) {
      const title = "⏰ Task Reminder";
      const body = `Your task "${task.text}" is due in ${minsLeft} minutes.`;
      console.log(`   🔔 ${displayName} — "${task.text}" is due in ${minsLeft} mins (triggered ${rt}-min reminder)`);

      for (const token of tokens) {
         await sendNotification(token, title, body, displayName);
        totalReminders++;
      }

      // ✅ Mark this reminder as sent so it’s not repeated
      if (!task.reminders) task.reminders = {};
       task.reminders[`${rt}min`] = true;
      }
}


  console.log(""); // spacing for clarity
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



