import axios from "axios";

interface EmailData {
  to: string;
  subject: string;
  template: string;
  data: any;
}

// Brevo config helper
const getBrevoConfig = () => {
  const apiKey = process.env["BREVO-API-KEY"];
  const fromEmail = process.env["BREVO-FROM-EMAIL"];
  const fromName = process.env["APP-NAME"] || "RHP Document";
  if (!apiKey) throw new Error("BREVO_API_KEY environment variable is not set");
  if (!fromEmail) throw new Error("BREVO_FROM_EMAIL is not set");
  return { apiKey, fromEmail, fromName };
};

// Email templates (same as before)
const emailTemplates = {
  "workspace-invitation": (data: any) => ({
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Workspace Invitation</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4B2A06; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px 20px; background: #f9f9f9; }
          .button { 
            display: inline-block; 
            background: #4B2A06; 
            color: white; 
            padding: 12px 30px; 
            text-decoration: none; 
            border-radius: 5px; 
            margin: 20px 0;
          }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
          .workspace-info { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Workspace Invitation</h1>
          </div>
          <div class="content">
            <h2>You're invited to join a workspace!</h2>
            <p>Hello,</p>
            <p><strong>${data.inviterName
      }</strong> has invited you to join the <strong>${data.workspaceName
      }</strong> workspace.</p>
            
            <div class="workspace-info">
              <h3>Workspace Details:</h3>
              <p><strong>Name:</strong> ${data.workspaceName}</p>
              <p><strong>Domain:</strong> ${data.workspaceDomain}</p>
              <p><strong>Your Role:</strong> ${data.invitedRole}</p>
              ${data.message
        ? `<p><strong>Message:</strong> ${data.message}</p>`
        : ""
      }
            </div>
            
            <p>Click the button below to accept this invitation:</p>
            <button style="text-align: center; margin: 20px 0;" onclick="window.location.href='${data.invitationUrl}'">
              Accept Invitation
            </button>
            
            <p><strong>Important:</strong> This invitation will expire on ${data.expiresAt
      }.</p>
            
            <p><strong>What happens next:</strong></p>
            <ul>
              <li>If you already have an account, you'll be logged in and redirected to the workspace</li>
              <li>If you don't have an account, you'll be prompted to create one first</li>
              <li>Once logged in, you'll have access to the workspace and can start collaborating</li>
            </ul>
            
            <p>If you can't click the button, copy and paste this link into your browser:</p>
            <a style="word-break: break-all; color: blue ; background: #f5f5f5; padding: 10px; border-radius: 3px;" href="${data.invitationUrl}">${data.invitationUrl}</a>
          </div>
          <div class="footer">
            <p>This invitation was sent by ${data.inviterName} (${data.workspaceDomain
      })</p>
            <p>If you didn't expect this invitation, you can safely ignore this email.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
      Workspace Invitation
      
      Hello,
      
      ${data.inviterName} has invited you to join the ${data.workspaceName
      } workspace.
      
      Workspace Details:
      - Name: ${data.workspaceName}
      - Domain: ${data.workspaceDomain}
      - Your Role: ${data.invitedRole}
      ${data.message ? `- Message: ${data.message}` : ""}
      
             To accept this invitation, visit: ${data.invitationUrl}
       
       Important: This invitation will expire on ${data.expiresAt}.
       
       What happens next:
       - If you already have an account, you'll be logged in and redirected to the workspace
       - If you don't have an account, you'll be prompted to create one first
       - Once logged in, you'll have access to the workspace and can start collaborating
       
       If you didn't expect this invitation, you can safely ignore this email.
    `,
  }),
  "profile-update-otp": (data: any) => ({
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Profile Update</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4B2A06; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px 20px; background: #f9f9f9; }
          .code { font-size: 28px; letter-spacing: 8px; font-weight: bold; background: #fff; padding: 12px 16px; border-radius: 8px; display: inline-block; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Verify Profile Update</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>Use the OTP code below to verify your profile update. This code will expire in ${data.expiresMinutes || 10} minutes.</p>
            <p class="code">${data.otp}</p>
            <p>If you did not request this change, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${process.env["APP-NAME"] || "RHP Document"}</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Verify Profile Update\n\nYour OTP is ${data.otp}. It expires in ${data.expiresMinutes || 10} minutes. If you did not request this change, ignore this email.`,
  }),
  "password-change-otp": (data: any) => ({
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Password Change</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4B2A06; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px 20px; background: #f9f9f9; }
          .code { font-size: 28px; letter-spacing: 8px; font-weight: bold; background: #fff; padding: 12px 16px; border-radius: 8px; display: inline-block; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Verify Password Change</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>Use the OTP code below to verify your password change. This code will expire in ${data.expiresMinutes || 10} minutes.</p>
            <p class="code">${data.otp}</p>
            <p>If you did not request this change, please secure your account immediately.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${process.env["APP-NAME"] || "RHP Document"}</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Verify Password Change\n\nYour OTP is ${data.otp}. It expires in ${data.expiresMinutes || 10} minutes. If you did not request this change, secure your account immediately.`,
  }),
  "registration-otp": (data: any) => ({
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4B2A06; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px 20px; background: #f9f9f9; }
          .code { font-size: 28px; letter-spacing: 8px; font-weight: bold; background: #fff; padding: 12px 16px; border-radius: 8px; display: inline-block; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Verify Your Email</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>Use the OTP code below to verify your email and complete your registration. This code will expire in ${data.expiresMinutes || 10} minutes.</p>
            <p class="code">${data.otp}</p>
            <p>If you did not attempt to register, you can ignore this email.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${process.env["APP-NAME"] || "RHP Document"}</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Verify Your Email\n\nYour OTP is ${data.otp}. It expires in ${data.expiresMinutes || 10} minutes. If you did not attempt to register, ignore this email.`,
  }),
  "directory-share": (data: any) => ({
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Directory Shared with You</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4B2A06; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px 20px; background: #f9f9f9; }
          .button { 
            display: inline-block; 
            background: #4B2A06; 
            color: white; 
            padding: 12px 30px; 
            text-decoration: none; 
            border-radius: 5px; 
            margin: 20px 0;
          }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
          .resource-info { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Directory Shared with You</h1>
          </div>
          <div class="content">
            <h2>You've been granted access to a directory!</h2>
            <p>Hello,</p>
            <p><strong>${data.sharerName || "A user"}</strong> has shared a ${data.resourceType === "directory" ? "directory" : "document"} with you.</p>
            
            <div class="resource-info">
              <h3>Resource Details:</h3>
              <p><strong>Name:</strong> ${data.resourceName || data.resourceId}</p>
              <p><strong>Type:</strong> ${data.resourceType === "directory" ? "Directory" : "Document"}</p>
              <p><strong>Access Level:</strong> ${data.role}</p>
              ${data.workspaceName ? `<p><strong>Workspace:</strong> ${data.workspaceName}</p>` : ""}
            </div>
            
            <p>You can now access this ${data.resourceType === "directory" ? "directory" : "document"} in your dashboard.</p>
            <div style="text-align: center; margin: 20px 0;">
              <a href="${data.dashboardUrl}" class="button" style="color: white; text-decoration: none;">
                Go to Dashboard
              </a>
            </div>
            
            <p>If you don't have an account yet, you'll need to <a href="${data.signupUrl}">sign up</a> first to access the shared resource.</p>
            
            <p>If you can't click the button, copy and paste this link into your browser:</p>
            <a style="word-break: break-all; color: blue; background: #f5f5f5; padding: 10px; border-radius: 3px; display: block; margin-top: 10px;" href="${data.dashboardUrl}">${data.dashboardUrl}</a>
          </div>
          <div class="footer">
            <p>This share was created by ${data.sharerName || "a user"} (${data.sharerDomain || "unknown domain"})</p>
            <p>If you didn't expect this share, you can safely ignore this email.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
      Directory Shared with You
      
      Hello,
      
      ${data.sharerName || "A user"} has shared a ${data.resourceType === "directory" ? "directory" : "document"} with you.
      
      Resource Details:
      - Name: ${data.resourceName || data.resourceId}
      - Type: ${data.resourceType === "directory" ? "Directory" : "Document"}
      - Access Level: ${data.role}
      ${data.workspaceName ? `- Workspace: ${data.workspaceName}` : ""}
      
      You can now access this ${data.resourceType === "directory" ? "directory" : "document"} in your dashboard.
      
      Visit: ${data.dashboardUrl}
      
      If you don't have an account yet, you'll need to sign up first to access the shared resource.
      
      If you didn't expect this share, you can safely ignore this email.
    `,
  }),
  "system-alert": (data: any) => ({
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>System Health Alert</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #d32f2f; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px 20px; background: #f9f9f9; }
          .service-item { border-bottom: 1px solid #eee; padding: 10px 0; }
          .status-error { color: #d32f2f; font-weight: bold; }
          .button { 
            display: inline-block; 
            background: #4B2A06; 
            color: white; 
            padding: 12px 30px; 
            text-decoration: none; 
            border-radius: 5px; 
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>System Health Alert</h1>
          </div>
          <div class="content">
            <h2 style="color: #d32f2f;">Critical Issue Detected</h2>
            <p><strong>Detected At:</strong> ${data.timestamp}</p>
            <p>The following services are experiencing issues:</p>
            <ul>
              ${data.failingServices.map((s: string) => `<li class="status-error">${s}</li>`).join('')}
            </ul>
            <div style="text-align: center;">
              <a href="${data.dashboardUrl}" class="button" style="color: white;">View Admin Dashboard</a>
            </div>
            <p>Please check the logs in the admin dashboard for more details.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `System Health Alert!\n\nCritical Issue Detected at ${data.timestamp}.\nFailing Services: ${data.failingServices.join(', ')}.\n\nView details: ${data.dashboardUrl}`,
  }),
};

export const sendEmail = async (emailData: EmailData): Promise<void> => {
  try {
    const { apiKey, fromEmail, fromName } = getBrevoConfig();

    console.log("📧 Using Brevo API to send email");
    console.log("   From:", `${fromName} <${fromEmail}>`);
    console.log("   To:", emailData.to);
    console.log("   Template:", emailData.template);

    // Check if template exists
    if (!emailTemplates[emailData.template as keyof typeof emailTemplates]) {
      throw new Error(`Email template '${emailData.template}' not found`);
    }

    // Get template content
    const template = emailTemplates[
      emailData.template as keyof typeof emailTemplates
    ](emailData.data);

    const resp = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { email: fromEmail, name: fromName },
        to: [{ email: emailData.to }],
        subject: emailData.subject,
        htmlContent: template.html,
        textContent: template.text,
      },
      { headers: { "api-key": apiKey, "content-type": "application/json" }, timeout: 15000 }
    );
    console.log("✅ Email sent successfully via Brevo!");
    console.log("   Message ID:", resp.data?.messageId || "n/a");
    console.log("   Recipient:", emailData.to);

    // If admin email is configured and this is a registration OTP, also send copy to admin
    if (process.env["ADMIN-EMAIL"] && emailData.template === "registration-otp") {
      try {
        await axios.post(
          "https://api.brevo.com/v3/smtp/email",
          {
            sender: { email: fromEmail, name: fromName },
            to: [{ email: process.env["ADMIN-EMAIL"] }],
            subject: `[Admin Copy] ${emailData.subject} - User: ${emailData.to}`,
            htmlContent: template.html,
            textContent: template.text,
          },
          { headers: { "api-key": apiKey, "content-type": "application/json" }, timeout: 15000 }
        );
        console.log(`✓ Admin copy sent to ${process.env["ADMIN-EMAIL"]}`);
      } catch (adminError) {
        console.error("Failed to send admin copy (non-critical):", adminError);
      }
    }
  } catch (error: any) {
    console.error("❌ Error sending email:", error);
    console.error("Error details:", {
      message: error?.message,
      stack: error?.stack,
    });
    throw error;
  }
};

// Test Brevo configuration on startup
export const testSmtpConnection = async (): Promise<boolean> => {
  try {
    console.log("🔍 Testing Brevo configuration on startup...");
    const apiKey = process.env["BREVO-API-KEY"];
    const fromEmail = process.env["BREVO-FROM-EMAIL"];
    if (!apiKey || !fromEmail) {
      console.warn("⚠️ Brevo not fully configured. Set BREVO_API_KEY and BREVO_FROM_EMAIL");
      return false;
    }
    console.log("✅ Brevo config present - Email service is ready");
    console.log("   From:", fromEmail);
    return true;
  } catch (error: any) {
    console.warn("⚠️ Brevo configuration test failed on startup:");
    console.warn("Error:", error.message);
    return false;
  }
};

export default sendEmail;
