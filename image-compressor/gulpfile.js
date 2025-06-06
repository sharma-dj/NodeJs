import gulp from 'gulp';
import imagemin from 'gulp-imagemin';

gulp.task('default', function(){
	return console.log("gulp is running")
})
gulp.task('imageMin', function(){
	gulp.src('src/images/*', { encoding: false })
		.pipe(imagemin())
		.pipe(gulp.dest('dist/images'))
})