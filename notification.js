// ============================================================================
// 🔹 notify.js
// Description: Scheduled script that checks Firestore tasks for all users
// and sends FCM notifications when a task is nearing its due date.
// ============================================================================


import { differenceInMinutes, parseISO } from "date-fns";
import admin from "firebase-admin";

const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


const db = admin.firestore();
const fcm = admin.messaging();

// 🔔 Send FCM notification
async function sendNotification(token, title, body) {
  try {
    await fcm.send({
      token,
      notification: { title, body },
    });
    console.log(`✅ Notification sent to token: ${token}`);
  } catch (error) {
    console.error("❌ Error sending FCM:", error.message);
  }
}

// 🧠 Main reminder check
async function checkTasks() {
  console.log("⏰ Checking tasks for reminders...");

  try {
    // 🔹 Emails to target (you can add or remove any)
const targetEmails = ["poornima20suresh@gmail.com", "poornimasuresh18@gmail.com"];

// 🔹 Fetch only those users whose email is in the target list
const usersSnap = await db.collection("users")
  .where("email", "in", targetEmails)
  .get();

    if (usersSnap.empty) {
      console.log("⚠️ No users found in Firestore.");
      return;
    }

    const now = new Date();

    // 🔹 Loop through each user document
    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const userEmail = userData.email || "(no email)";
      console.log(`👤 Checking user: ${userEmail}`);

      // Find user tasks under /users/{uid}/tasks
      const tasksRef = db.collection("users").doc(userDoc.id).collection("tasks");
      const tasksSnap = await tasksRef.get();

      if (tasksSnap.empty) {
        console.log(`⚠️ No tasks found for ${userEmail}`);
        continue;
      }

      for (const taskDoc of tasksSnap.docs) {
        const task = taskDoc.data();

        if (!task.dueDate || !task.fcmToken) continue;

        const dueDate = parseISO(task.dueDate);
        const minsLeft = differenceInMinutes(dueDate, now);

        // 🔔 Notify if due within 60 mins and not already sent
        if (minsLeft <= 60 && minsLeft > 0 && !task.reminderSent) {
          console.log(`🔔 ${userEmail}: Task "${task.title}" due in ${minsLeft} mins.`);

          await sendNotification(
            task.fcmToken,
            "⏰ Task Reminder",
            `Your task "${task.title}" is due soon!`
          );

          await tasksRef.doc(taskDoc.id).update({ reminderSent: true });
        }
      }
    }

    console.log("✅ All user tasks checked successfully.");
  } catch (err) {
    console.error("❌ Error checking tasks:", err);
  }
}

// Run once immediately (Render will trigger it via cron)
checkTasks().then(() => process.exit());
