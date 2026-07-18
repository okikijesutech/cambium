export function processUser(user: any, opts: any) {
  if (user && user.active) {
    if (opts.strict || user.role === "admin") {
      for (const key in user.permissions) {
        if (user.permissions[key] && key !== "temp") {
          console.log(key);
        }
      }
    } else if (user.role === "guest") {
      switch (opts.mode) {
        case "read":
          return true;
        case "write":
          return false;
        default:
          return null;
      }
    }
  } else {
    try {
      doSomething();
    } catch (e) {
      console.error(e);
    }
  }

  const label = user?.name ?? "unknown";
  return opts.verbose && user ? label : null;
}

function doSomething() {
  return true;
}

export const CONFIG = { retries: 3 };
