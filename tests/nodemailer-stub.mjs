// Minimal nodemailer stub for email tests: captures sent mail, never delivers.
export default {
  createTransport: () => ({
    sendMail: async (message) => {
      globalThis.__testSentEmails.push(message);
      return { messageId: "test-message-id" };
    },
  }),
};
