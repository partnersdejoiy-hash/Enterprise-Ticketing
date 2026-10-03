// Test-only module hook: redirects `nodemailer` imports to a stub so no
// real SMTP connection is ever attempted. Registered via module.register()
// before the app is imported, so it only affects this test file's process.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "nodemailer") {
    return {
      url: new URL("./nodemailer-stub.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
