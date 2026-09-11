# Homebrew formula for the MindScript Studio CLI (macOS arm64).
# Lives here until the repo is public; then it moves to MST-betterAI/homebrew-tap
# (Formula/mindscript.rb) and users run:  brew install MST-betterAI/tap/mindscript
# Update the url/version/sha256 on every release (script/homebrew/update.sh).
class Mindscript < Formula
  desc "MindScript Studio — a coding agent that picks the best-value model for every step"
  homepage "https://github.com/MST-betterAI/mindscript-studio"
  version "0.1.0"
  url "https://github.com/MST-betterAI/mindscript-studio/releases/download/studio-v0.1.0/mindscript-darwin-arm64.zip"
  sha256 "d02a11c01dad2580f1c81bcf394a8e100a8b6fdb2d55ac0624dbbb07470feefe"
  license "MIT"

  depends_on :macos
  depends_on arch: :arm64

  def install
    bin.install "mindscript"
  end

  test do
    assert_match "1.18.30", shell_output("#{bin}/mindscript --version")
  end
end
