package expo.modules.velorasystemcalls

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Space
import android.widget.TextView

/**
 * Full-screen incoming-call surface used as the full-screen intent target.
 * Mirrors the in-app call identity layout: dimmed blurred avatar backdrop,
 * circular peer avatar with initial fallback, and round ripple action
 * buttons. The answer/reject flow (pending action journal, watchdog,
 * hand-off to the main activity) is intentionally identical to the previous
 * implementation — only the presentation changed.
 */
class VeloraIncomingCallActivity : Activity() {
  private var payload: Map<String, Any?> = emptyMap()
  private var dismissReceiverRegistered = false
  private var renderGeneration = 0
  private var answerPulseAnimator: ValueAnimator? = null
  private var avatarFrame: FrameLayout? = null
  private var backdropView: ImageView? = null
  private var contentScroller: ScrollView? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  private val dismissReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      val dismissedCallId = intent.getStringExtra("callId") ?: return
      val currentCallId = payload["callId"] as? String ?: return
      if (dismissedCallId == currentCallId) {
        finish()
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    showOverLockScreen()
    applyWindowColors()
    payload = VeloraSystemCallStore.payloadFromIntent(intent)

    if (handleNotificationAction(intent)) {
      return
    }

    render()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    payload = VeloraSystemCallStore.payloadFromIntent(intent)

    if (!handleNotificationAction(intent)) {
      render()
    }
  }

  override fun onStart() {
    super.onStart()
    val callId = payload["callId"] as? String
    if (callId == null || !VeloraSystemCallStore.shouldKeepIncomingPresentation(this, callId)) {
      finish()
      return
    }

    val filter = IntentFilter(VeloraCallNotifications.dismissIncomingActivityAction())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(dismissReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      registerReceiver(dismissReceiver, filter)
    }
    dismissReceiverRegistered = true
  }

  override fun onStop() {
    if (dismissReceiverRegistered) {
      unregisterReceiver(dismissReceiver)
      dismissReceiverRegistered = false
    }
    super.onStop()
  }

  override fun onDestroy() {
    answerPulseAnimator?.cancel()
    answerPulseAnimator = null
    super.onDestroy()
  }

  private fun handleNotificationAction(intent: Intent): Boolean {
    val action = intent.getStringExtra("veloraAction")
    if (action != "answer" && action != "reject") {
      return false
    }

    complete(action)
    return true
  }

  // ── Presentation ────────────────────────────────────────────────────────────

  private fun render() {
    renderGeneration += 1
    answerPulseAnimator?.cancel()
    answerPulseAnimator = null
    avatarFrame = null
    backdropView = null
    contentScroller = null

    val density = resources.displayMetrics.density

    val root = FrameLayout(this).apply { setBackgroundColor(COLOR_BACKGROUND) }

    val backdrop = ImageView(this).apply {
      scaleType = ImageView.ScaleType.CENTER_CROP
      alpha = 0f
    }
    backdropView = backdrop
    root.addView(
      backdrop,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )
    root.addView(
      View(this).apply {
        background = GradientDrawable(
          GradientDrawable.Orientation.TOP_BOTTOM,
          intArrayOf(
            Color.argb(222, 5, 9, 12),
            Color.argb(26, 5, 9, 12),
            Color.argb(64, 5, 9, 12),
            Color.argb(245, 5, 9, 12),
          ),
        )
      },
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )

    val scroller = ScrollView(this).apply {
      isFillViewport = true
      overScrollMode = ScrollView.OVER_SCROLL_NEVER
    }
    contentScroller = scroller
    scroller.addView(
      buildContentColumn(density),
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      ),
    )
    root.addView(
      scroller,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )

    setContentView(root)
    applyWindowInsetPadding(scroller)
    loadAvatarAsync()
  }

  private fun buildContentColumn(density: Float): LinearLayout {
    fun dp(value: Int): Int = (value * density).toInt()
    val callerName = callerName()
    val isVideoCall = isVideoCall()

    val column = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(dp(24), dp(36), dp(24), dp(28))
    }

    column.addView(buildAvatarRow(callerName, ::dp))
    column.addView(
      TextView(this).apply {
        text = callerName
        textSize = 30f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(COLOR_TEXT_PRIMARY)
        gravity = Gravity.CENTER
        setLineSpacing(0f, 1.1f)
        minWidth = dp(220)
        maxLines = 2
        val params = LinearLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        params.topMargin = dp(24)
        layoutParams = params
      },
    )
    column.addView(
      TextView(this).apply {
        text = if (isVideoCall) "Incoming video call" else "Incoming voice call"
        textSize = 16f
        setTextColor(COLOR_TEXT_SECONDARY)
        gravity = Gravity.CENTER
        val params = LinearLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        params.topMargin = dp(8)
        layoutParams = params
      },
    )

    val actionsRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
      val params = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      )
      params.topMargin = dp(48)
      layoutParams = params
    }
    actionsRow.addView(
      buildCallButton(
        label = "Decline",
        iconRes = R.drawable.ic_velora_call_decline,
        backgroundColor = COLOR_DECLINE,
        actionDescription = "Decline call",
        dp = ::dp,
      ) { complete("reject") },
    )
    actionsRow.addView(
      Space(this).apply {
        layoutParams = LinearLayout.LayoutParams(dp(56), dp(1))
      },
    )
    actionsRow.addView(
      buildCallButton(
        label = "Answer",
        iconRes = if (isVideoCall) R.drawable.ic_velora_videocam else R.drawable.ic_velora_call_answer,
        backgroundColor = COLOR_ANSWER,
        actionDescription = if (isVideoCall) "Answer video call" else "Answer call",
        withPulse = true,
        dp = ::dp,
      ) { complete("answer") },
    )
    column.addView(actionsRow)
    return column
  }

  private fun buildAvatarRow(callerName: String, dp: (Int) -> Int): View {
    val frame = FrameLayout(this).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(COLOR_AVATAR_FALLBACK)
        setStroke(dp(1), COLOR_AVATAR_BORDER)
      }
    }
    val size = dp(110)
    val layoutParams = LinearLayout.LayoutParams(size, size)
    layoutParams.gravity = Gravity.CENTER_HORIZONTAL
    frame.layoutParams = layoutParams

    frame.addView(
      TextView(this).apply {
        text = callerName.trim().take(1).uppercase().ifEmpty { "?" }
        textSize = 40f
        setTextColor(COLOR_TEXT_PRIMARY)
        gravity = Gravity.CENTER
        setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL))
      },
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )
    frame.addView(
      ImageView(this).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        visibility = View.GONE
      },
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )
    avatarFrame = frame
    return frame
  }

  private fun buildCallButton(
    label: String,
    iconRes: Int,
    backgroundColor: Int,
    actionDescription: String,
    withPulse: Boolean = false,
    dp: (Int) -> Int,
    onClick: () -> Unit,
  ): View {
    val buttonRoot = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      isClickable = true
      isFocusable = true
      contentDescription = actionDescription
      setOnClickListener { onClick() }
    }

    val circleHolder = FrameLayout(this).apply {
      val size = dp(68)
      layoutParams = LinearLayout.LayoutParams(size, size)
    }

    var pulseView: View? = null
    if (withPulse) {
      pulseView = View(this).apply {
        background = GradientDrawable().apply {
          shape = GradientDrawable.OVAL
          setColor(COLOR_ANSWER_PULSE)
        }
        visibility = View.INVISIBLE
      }
      circleHolder.addView(
        pulseView,
        FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT,
        ),
      )
    }

    val circle = FrameLayout(this).apply {
      background = RippleDrawable(
        ColorStateList.valueOf(COLOR_CONTROL_RIPPLE),
        GradientDrawable().apply {
          shape = GradientDrawable.OVAL
          setColor(backgroundColor)
        },
        null,
      )
      isClickable = true
      isFocusable = true
      contentDescription = actionDescription
      setOnClickListener { onClick() }
    }
    circleHolder.addView(
      circle,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )

    circle.addView(
      ImageView(this).apply { setImageResource(iconRes) },
      FrameLayout.LayoutParams(dp(28), dp(28), Gravity.CENTER),
    )

    buttonRoot.addView(circleHolder)
    buttonRoot.addView(
      TextView(this).apply {
        text = label
        textSize = 13f
        setTextColor(COLOR_TEXT_SECONDARY)
        gravity = Gravity.CENTER
        val params = LinearLayout.LayoutParams(
          ViewGroup.LayoutParams.WRAP_CONTENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        params.topMargin = dp(10)
        layoutParams = params
      },
    )

    pulseView?.let { startAnswerPulse(it) }
    return buttonRoot
  }

  private fun applyWindowInsetPadding(insetTarget: View) {
    insetTarget.setOnApplyWindowInsetsListener { view, insets ->
      @Suppress("DEPRECATION")
      val systemWindowInsets = insets.systemWindowInsets
      view.setPadding(
        systemWindowInsets.left,
        systemWindowInsets.top,
        systemWindowInsets.right,
        systemWindowInsets.bottom,
      )
      insets
    }
  }

  private fun applyWindowColors() {
    window.statusBarColor = COLOR_BACKGROUND
    window.navigationBarColor = COLOR_BACKGROUND
  }

  // ── Avatar ──────────────────────────────────────────────────────────────────

  private fun loadAvatarAsync() {
    val avatarUrl = payload["initiatorAvatarUrl"] as? String ?: return
    val callId = payload["callId"] as? String ?: return
    val generation = renderGeneration
    val displayMetrics = resources.displayMetrics
    val targetPx = (220 * displayMetrics.density).toInt()
    val backdropWidth = displayMetrics.widthPixels
    val backdropHeight = displayMetrics.heightPixels

    Thread {
      val source = VeloraCallAvatars.fetchAvatar(avatarUrl) ?: return@Thread
      val circularAvatar = try {
        VeloraCallAvatars.circular(source, targetPx)
      } catch (_: Exception) {
        null
      } ?: return@Thread
      val backdrop = try {
        VeloraCallAvatars.blurredBackdrop(source, backdropWidth, backdropHeight)
      } catch (_: Exception) {
        null
      }

      mainHandler.post {
        if (
          isFinishing ||
          isDestroyed ||
          generation != renderGeneration ||
          payload["callId"] != callId
        ) {
          return@post
        }

        findAvatarImageView()?.setImageBitmap(circularAvatar)
        backdrop?.let { bitmap ->
          backdropView?.setImageBitmap(bitmap)
          backdropView?.animate()?.alpha(0.36f)?.setDuration(320)?.start()
        }
      }
    }.start()
  }

  private fun findAvatarImageView(): ImageView? {
    val frame = avatarFrame ?: return null
    for (index in 0 until frame.childCount) {
      val child = frame.getChildAt(index)
      if (child is ImageView) return child
    }
    return null
  }

  // ── Answer pulse halo ───────────────────────────────────────────────────────

  private fun startAnswerPulse(pulseView: View) {
    if (animationsDisabled()) {
      return
    }

    val animator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 1_400
      repeatCount = ValueAnimator.INFINITE
      repeatMode = ValueAnimator.RESTART
      addUpdateListener { animation ->
        val progress = animation.animatedValue as Float
        pulseView.scaleX = 1f + 0.45f * progress
        pulseView.scaleY = 1f + 0.45f * progress
        pulseView.alpha = 0.55f * (1f - progress)
      }
      addListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: Animator) {
          pulseView.visibility = View.INVISIBLE
        }
      })
    }
    pulseView.visibility = View.VISIBLE
    pulseView.alpha = 0f
    animator.start()
    answerPulseAnimator = animator
  }

  private fun animationsDisabled(): Boolean =
    try {
      Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    } catch (_: Exception) {
      true
    }

  // ── Call action plumbing (unchanged from the previous implementation) ───────

  private fun complete(action: String) {
    val callId = payload["callId"] as? String ?: return
    VeloraCallNotifications.cancelIncomingCallExpiration(this, callId)
    VeloraSystemCallStore.storePendingAction(this, action, payload)
    if (action == "answer") {
      val pendingAnswer = VeloraSystemCallStore.pendingAnswerAction(this, callId)
      val actionId = pendingAnswer?.get("actionId") as? String
      if (!actionId.isNullOrBlank()) {
        VeloraCallNotifications.schedulePendingAnswerWatchdog(
          this,
          callId,
          actionId,
          pendingAnswer["createdAt"] as? String,
        )
      }
    }
    VeloraCallNotifications.dismissIncomingPresentation(this, callId)
    VeloraCallNotifications.launchMainActivity(this)
    finish()
  }

  private fun showOverLockScreen() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  private fun callerName(): String =
    (payload["initiatorDisplayName"] as? String)
      ?.takeIf { it.isNotBlank() }
      ?: "Velora call"

  private fun isVideoCall(): Boolean =
    (payload["callType"] as? String)?.uppercase() == "VIDEO"

  private companion object {
    private val COLOR_BACKGROUND = Color.parseColor("#05090C")
    private val COLOR_TEXT_PRIMARY = Color.parseColor("#F7F7F8")
    private val COLOR_TEXT_SECONDARY = Color.parseColor("#B2B4B8")
    private val COLOR_AVATAR_FALLBACK = Color.parseColor("#7E858C")
    private val COLOR_AVATAR_BORDER = Color.parseColor("#29FFFFFF")
    private val COLOR_ANSWER = Color.parseColor("#34C759")
    private val COLOR_ANSWER_PULSE = Color.parseColor("#34C759")
    private val COLOR_DECLINE = Color.parseColor("#FF163D")
    private val COLOR_CONTROL_RIPPLE = Color.parseColor("#33FFFFFF")
  }
}
