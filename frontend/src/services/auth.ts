import { api } from "@/services/api";

export type AuthUser = {
  id: string;
  email: string;
  full_name?: string | null;
  onboardingComplete: boolean;
};

function withOnboarding(user: Omit<AuthUser, "onboardingComplete">, complete: boolean): AuthUser {
  return { ...user, onboardingComplete: complete };
}

export const AuthService = {
  async signIn(identifier: string, password: string): Promise<{ user: AuthUser; nextRoute: string }> {
    const session = await api.login(identifier, password);
    const status = await api.onboardingStatus();
    return { user: withOnboarding(session.user, status.onboarding_completed), nextRoute: status.next_route };
  },

  signUp(email: string, password: string) {
    return api.signup(email, password);
  },

  startSignUp(email: string) {
    return api.startSignup(email);
  },

  acceptSignupLink(accessToken: string, refreshToken: string) {
    return api.acceptSignupLink(accessToken, refreshToken);
  },

  verifySignUp(email: string, code: string) {
    return api.verifySignup(email, code);
  },

  completeSignUp(password: string) {
    return api.completeSignup(password);
  },

  async verifyOtp(email: string, code: string): Promise<AuthUser> {
    const session = await api.verifyEmail(email, code);
    const status = await api.onboardingStatus();
    return withOnboarding(session.user, status.onboarding_completed);
  },

  sendOtp(email: string) {
    return api.resendVerification(email);
  },

  forgotPassword(email: string) {
    return api.forgotPassword(email);
  },

  resetPassword(token: string, password: string) {
    return api.resetPassword(token, password);
  },
};
