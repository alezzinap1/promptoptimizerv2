import styles from './Settings.module.css'

export default function Settings() {
  return (
    <div className={styles.settings}>
      <h1>Настройки</h1>
      <h2>Оформление</h2>
      <p className={styles.info}>
        Тема и шрифт можно изменить в <strong>верхней панели</strong> справа (доступны на всех страницах).
      </p>
    </div>
  )
}
