const musicPlaylist = [
      "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
      "assets/audio/music/Dawn_Light_On_Stone.mp3",
      "assets/audio/music/The_Gravity_Cage.mp3",
      "assets/audio/music/Gravity_s_Edge.mp3",
      "assets/audio/music/Plaza_Mornings.mp3"
    ];
    function setRandomMusic() {
      const bgMusic = document.getElementById('bg-music');
      bgMusic.src = musicPlaylist[Math.floor(Math.random() * musicPlaylist.length)];
    }
    window.addEventListener('DOMContentLoaded', setRandomMusic);
